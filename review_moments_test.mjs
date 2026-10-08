// Review moments (Google review asks, 2026-10-08): the REAL review-moments function, the REAL staff check and job check,
// against a fake database. node review_moments_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const D = (n) => new Date(Date.now() + n * 864e5).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const uid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16))
const clone = (x) => JSON.parse(JSON.stringify(x))
let T
// clients: 10 Hilda (kind words), 11 Carl (Care Match love), 12 Stella (5-star check-in), 13 Fix (resolved problem then kind words),
// 14 Lon (long-term, two 4-star check-ins), 20 Paula (paused), 21 Pete (past), 22 Dee (deceased), 23 Sam (starting), 24 Nina (new, 5 days),
// 25 Opal (open concern), 26 Eve (escalated check-in), 27 Ari (asked 30 days ago), 28 Ned (not now 10 days ago), 29 Sly (sliding 5 → 3), 30 Old (kind words 40 days ago)
const reset = (live = true) => {
  const people = [['10', 'Hilda Happy'], ['11', 'Carl Match'], ['12', 'Stella Star'], ['13', 'Fix Problem'], ['14', 'Lon Term'], ['20', 'Paula Paused'], ['21', 'Pete Past'], ['22', 'Dee Gone'],
    ['23', 'Sam Start'], ['24', 'Nina New'], ['25', 'Opal Open'], ['26', 'Eve Escalated'], ['27', 'Ari Asked'], ['28', 'Ned Notnow'], ['29', 'Sly Slide'], ['30', 'Old Words']]
  T = {
    person_identity: people.map(([ax, n]) => ({ id: 'p' + ax, display_name: n })),
    person_source_id: people.map(([ax]) => ({ person_id: 'p' + ax, system: 'axiscare', entity_type: 'client', source_id: ax })),
    person_role: people.map(([ax]) => ({ person_id: 'p' + ax, role: 'client', status: ['21', '22'].includes(ax) ? 'former' : 'active', end_reason: ax === '22' ? 'deceased' : null,
      started_at: ax === '24' ? D(-5) : ax === '14' ? D(-400) : D(-60) })),
    client_pause: [{ axiscare_client_id: '20', status: 'open', pause_id: 'pz' }],
    client_journey: [{ axiscare_client_id: '23', status: 'open', created_at: D(-3) + 'T10:00:00Z', assigned_cc: 'angie@mo-care.com' }, { axiscare_client_id: '10', status: 'active', created_at: D(-60) + 'T10:00:00Z', assigned_cc: 'krystal@mo-care.com' }],
    kind_words: [
      { id: 'k1', quote: 'Maria is an angel, Mom lights up when she comes', who: 'Hilda\'s daughter', about: 'Maria Lopez', about_role: 'caregiver', said_on: D(-2), link: { type: 'client', ax: '10' }, status: 'kind' },
      { id: 'k2', quote: 'Thank you for fixing the schedule so fast', who: 'Fix\'s son', about: '', about_role: '', said_on: D(-1), link: { type: 'client', ax: '13' }, status: 'kind' },
      { id: 'k3', quote: 'You are wonderful', who: 'Old\'s wife', about: '', about_role: '', said_on: D(-40), link: { type: 'client', ax: '30' }, status: 'kind' },
      { id: 'k4', quote: 'Great care', who: 'Pete\'s son', about: '', said_on: D(-1), link: { type: 'client', ax: '21' }, status: 'kind' },
      { id: 'k5', quote: 'Lovely', who: 'Dee\'s son', about: '', said_on: D(-1), link: { type: 'client', ax: '22' }, status: 'kind' },
      { id: 'k6', quote: 'Wonderful', who: 'Paula', about: '', said_on: D(-1), link: { type: 'client', ax: '20' }, status: 'kind' },
      { id: 'k7', quote: 'not confirmed yet', who: 'x', about: '', said_on: D(-1), link: { type: 'client', ax: '25' }, status: 'suggested' }],
    client_issue: [{ axiscare_client_id: '13', state: 'resolved', summary: 'Missed Tuesday visits', resolved_at: D(-6) + 'T12:00:00Z' }, { axiscare_client_id: '25', state: 'in_progress', summary: 'Late caregiver' }],
    review_ask: [{ ask_id: uid(), axiscare_client_id: '27', client_name: 'Ari Asked', moment: 'checkin', moment_ref: 'ci:old27', status: 'asked', outcome: 'didnt', asked_at: D(-30) + 'T12:00:00Z', created_at: D(-31) + 'T12:00:00Z', asked_how: 'text', asked_by: 'x' },
      { ask_id: uid(), axiscare_client_id: '28', moment: 'checkin', moment_ref: 'ci:old28', status: 'not_now', updated_at: D(-10) + 'T12:00:00Z', created_at: D(-11) + 'T12:00:00Z' }],
    app_data: [{ key: 'ops_settings', data: { review_asks_live: live } }, { key: 'ops_items', data: [] }, { key: 'client_checkins', data: [
      { id: 'c11', client: 'Carl Match', caregiver: 'Bea Kind', rating: 'love', at: D(-3) + 'T15:00:00Z', spoke_with: 'Carl\'s wife Jan', axiscare_client_id: '11' },
      { id: 'c12', client_name: 'Stella Star', checkin_date: D(-4), satisfaction_rating: 5, spoke_with: 'Stella', axiscare_client_id: '12' },
      { id: 'c14a', client_name: 'Lon Term', checkin_date: D(-120), satisfaction_rating: 4, axiscare_client_id: '14' }, { id: 'c14b', client_name: 'Lon Term', checkin_date: D(-30), satisfaction_rating: 4, spoke_with: 'Lon', axiscare_client_id: '14' },
      { id: 'c26', client_name: 'Eve Escalated', checkin_date: D(-2), satisfaction_rating: 5, escalated: true, axiscare_client_id: '26' },
      { id: 'c27', client_name: 'Ari Asked', checkin_date: D(-2), satisfaction_rating: 5, axiscare_client_id: '27' }, { id: 'c28', client_name: 'Ned Notnow', checkin_date: D(-2), satisfaction_rating: 5, axiscare_client_id: '28' },
      { id: 'c29a', client_name: 'Sly Slide', checkin_date: D(-40), satisfaction_rating: 5, axiscare_client_id: '29' }, { id: 'c29b', client_name: 'Sly Slide', checkin_date: D(-3), satisfaction_rating: 4, axiscare_client_id: '29' },
      { id: 'c24', client_name: 'Nina New', checkin_date: D(-2), satisfaction_rating: 5, axiscare_client_id: '24' }, { id: 'c23', client_name: 'Sam Start', checkin_date: D(-1), satisfaction_rating: 5, axiscare_client_id: '23' }] }],
    auth_identities: [['u-kr', 'p-kr'], ['u-an', 'p-an'], ['u-sam', 'p-sam'], ['u-sal', 'p-sal']].map(([a, p]) => ({ auth_user_id: a, project_ref: 'zngsgedlsxinbygwmxwn', person_id: p })),
    persons: [['p-kr', 'Krystal Land', 'krystal@mo-care.com'], ['p-an', 'Angie Care', 'angie@mo-care.com'], ['p-sam', 'Samantha Owner', 'sam@mo-care.com'], ['p-sal', 'Sally Staffing', 'sally@mo-care.com']]
      .map(([person_id, full_name, primary_email]) => ({ person_id, full_name, primary_email, active: true })),
    entity_memberships: ['p-kr', 'p-an', 'p-sam', 'p-sal'].map((person_id) => ({ person_id, entity: 'cc_ihs', active: true, ended_at: null })),
    staff_roles: [['p-kr', 'care_coordinator'], ['p-an', 'care_coordinator'], ['p-sam', 'owner_admin'], ['p-sal', 'staffing_coordinator']].map(([person_id, role]) => ({ person_id, entity: 'cc_ihs', role })) }
}
function q(t) {
  const st = { f: [], op: 'select', patch: null, row: null, single: false }
  const match = (r) => st.f.every(([k, v, how]) => how === 'in' ? v.includes(r[k]) : how === 'is' ? (r[k] ?? null) === v : how === 'lte' ? String(r[k]) <= String(v) : how === 'gte' ? String(r[k]) >= String(v) : String(r[k]) === String(v))
  const run = () => {
    T[t] = T[t] || []
    if (st.op === 'insert') { const r = { ...st.row }
      if (t === 'review_ask') {
        if (T[t].some((x) => x.status === 'suggested' && x.axiscare_client_id === r.axiscare_client_id)) return { data: null, error: { message: 'duplicate key value violates unique constraint "review_ask_one_open"' } }
        if (r.moment_ref && T[t].some((x) => x.moment === r.moment && x.moment_ref === r.moment_ref)) return { data: null, error: { message: 'review_ask_one_per_moment' } }
        Object.assign(r, { ask_id: uid(), status: 'suggested', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }
      T[t].push(r); return { data: st.single ? clone(r) : [clone(r)], error: null } }
    if (st.op === 'update') { T[t].filter(match).forEach((r) => Object.assign(r, st.patch)); return { data: null, error: null } }
    let rows = T[t].filter(match)
    if (st.order) rows = rows.slice().sort((a, b) => (st.order.asc ? 1 : -1) * String(a[st.order.k]).localeCompare(String(b[st.order.k])))
    return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null }
  }
  const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b }, in(k, v) { st.f.push([k, v, 'in']); return b }, is(k, v) { st.f.push([k, v, 'is']); return b },
    lte(k, v) { st.f.push([k, v, 'lte']); return b }, gte(k, v) { st.f.push([k, v, 'gte']); return b }, limit() { return b }, order(k, o) { st.order = { k, asc: o?.ascending !== false }; return b },
    insert(row) { st.op = 'insert'; st.row = row; return b }, update(p) { st.op = 'update'; st.patch = p; return b },
    single() { st.single = true; return Promise.resolve(run()) }, maybeSingle() { st.single = true; return Promise.resolve(run()) }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko) } }
  return b
}
globalThis.__db = { from: q,
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)) } return { data: null, error: null } },
  auth: { getUser: async (jwt) => { const m = { kr: ['u-kr', 'krystal@mo-care.com'], an: ['u-an', 'angie@mo-care.com'], sam: ['u-sam', 'sam@mo-care.com'], sal: ['u-sal', 'sally@mo-care.com'] }[jwt]
    return m ? { data: { user: { id: m[0], email: m[1], app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } } }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', HUB_JOB_SECRET: 'j'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_rv_'))
try {
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), fs.readFileSync(path.join(F, '_shared/job-auth.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: {} }) }) }) })')
    .replace("'./staff-auth.ts'", "'" + path.join(process.cwd(), F, '_shared', 'staff-auth.ts') + "'"))
  const src = fs.readFileSync(path.join(F, 'review-moments/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace("'../_shared/job-auth.ts'", "'" + path.join(tmp, 'job-auth.ts') + "'").replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'rv.ts'), src); const M = await import(path.join(tmp, 'rv.ts'))
  const call = async (body, jwt = 'an', hdr = {}) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}), ...hdr }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
  const job = { 'x-cron-secret': ENV.HUB_JOB_SECRET }
  const cards = (k = 'review_ask') => T.app_data.find((r) => r.key === 'ops_items').data.filter((x) => x.kind === k)
  const askOf = (ax) => T.review_ask.filter((a) => a.axiscare_client_id === ax && a.moment_ref !== 'ci:old27' && a.moment_ref !== 'ci:old28')

  reset(false); let r = await call({ action: 'sweep' }, null)
  ck('the sweep answers only its schedule or the owner\'s script', r.status === 403)
  r = await call({ action: 'sweep' }, null, job)
  ck('switched off: it lists who it WOULD suggest and writes nothing', r.j.live === false && r.j.would_suggest === 5 && r.j.suggested === 0 && askOf('10').length === 0 && cards().length === 0, r.j)
  ck('...her five moments: kind words (Hilda), Care Match love (Carl), a 5-star check-in (Stella), a solved problem (Fix), long-term (Lon)',
    ['Hilda Happy:kind_words', 'Carl Match:care_match', 'Stella Star:checkin', 'Fix Problem:solved', 'Lon Term:long_term'].every((x) => r.j.list.some((l) => l.name + ':' + l.moment === x)), r.j.list)
  ck('...never: paused, past, deceased, starting, the first two weeks, an open concern, an escalated or sliding check-in, asked in 90 days, Not now in 30 days, old words, unconfirmed words',
    !r.j.list.some((l) => /Paula|Pete|Dee|Sam|Nina|Opal|Eve|Ari|Ned|Sly|Old/.test(l.name)) && r.j.skipped.paused === 1 && r.j.skipped['starting care'] === 1 && r.j.skipped['first two weeks'] === 1
    && r.j.skipped['open concern'] === 1 && r.j.skipped['escalated check-in'] === 1 && r.j.skipped['check-ins sliding'] === 1 && r.j.skipped['asked in the last 90 days'] === 1 && r.j.skipped['not now, recently'] === 1, r.j.skipped)

  reset(true); r = await call({ action: 'sweep' }, null, job)
  const hilda = askOf('10')[0], hc = cards().find((c) => c.axiscare_client_id === '10')
  ck('live: five suggestions, one card each', r.j.suggested === 5 && cards().length === 5, r.j)
  ck('...Hilda\'s card goes to HER Care Coordinator (Krystal), quotes the words, and links to her profile', hc && hc.owner === 'krystal@mo-care.com' && /Maria is an angel/.test(hc.detail) && hc.link === '#p/A10/summary' && /Ask Hilda's daughter for a Google review\?/.test(hc.title), hc)
  ck('...no Care Coordinator on record: the default (first Care Coordinator), never nobody', cards().every((c) => c.owner), cards().map((c) => c.owner))
  ck('...Fix: "This came after we sorted out: Missed Tuesday visits"', /after we sorted out: Missed Tuesday visits/.test(cards().find((c) => c.axiscare_client_id === '13').detail))
  ck('...each card says nothing is sent by the Hub', cards().every((c) => /Nothing is sent by the Hub/.test(c.detail)))
  r = await call({ action: 'sweep' }, null, job)
  ck('run again: nothing doubled', r.j.suggested === 0 && cards().length === 5, r.j)

  r = await call({ action: 'review_state', axiscare_client_id: '10' }, 'kr')
  ck('profile: the open suggestion and the message to copy, with the verified review link', r.j.open && r.j.open.ask_id === hilda.ask_id && r.j.message.includes(M.REVIEW_URL) && /Thank you for the kind words about Maria/.test(r.j.message) && !/—/.test(r.j.message), r.j.message)
  const st12 = askOf('12')[0]
  ck('...a plain first name is greeted ("Hi Stella"); "Hilda\'s daughter" is not ("Hi,")', M.messageFor(st12, 'Stella Star', 'Angie Care', M.REVIEW_URL).startsWith('Hi Stella, this is Angie') && r.j.message.startsWith('Hi, this is Krystal'), [st12, r.j.message])
  ck('...no em dashes anywhere in the cards or message', !/—/.test(JSON.stringify(cards())) && !/—/.test(r.j.message))
  r = await call({ action: 'review_asked', ask_id: hilda.ask_id }, 'kr')
  ck('asked: needs how (text, call, in person, email)', r.j.outcome === 'refused')
  r = await call({ action: 'review_asked', ask_id: hilda.ask_id, how: 'text', who: 'Hilda\'s daughter Rosa' }, 'kr')
  ck('...recorded: who asked, how, whom, when; the card closes', r.j.outcome === 'asked' && T.review_ask.find((a) => a.ask_id === hilda.ask_id).asked_by === 'krystal@mo-care.com' && hc && cards().find((c) => c.id === hc.id).status === 'done', T.review_ask.find((a) => a.ask_id === hilda.ask_id))
  r = await call({ action: 'review_asked', ask_id: hilda.ask_id, how: 'call' }, 'kr')
  ck('...can\'t be recorded twice', r.j.outcome === 'refused')
  const carl = askOf('11')[0]; r = await call({ action: 'review_not_now', ask_id: carl.ask_id, note: 'Jan sounded tired today' }, 'an')
  ck('Not now: closes the card, kept with the reason; no ask for 30 days', r.j.outcome === 'not_now' && carl && cards().find((c) => c.axiscare_client_id === '11').status === 'done' && T.review_ask.find((a) => a.ask_id === carl.ask_id).note === 'Jan sounded tired today')
  T.review_ask.find((a) => a.ask_id === hilda.ask_id).asked_at = D(-8) + 'T12:00:00Z'
  r = await call({ action: 'sweep' }, null, job)
  const fu = cards('review_followup')[0]
  ck('a week after asking: ONE card "Did Hilda\'s daughter Rosa leave a Google review?" for the person who asked', r.j.followups === 1 && fu && fu.owner === 'krystal@mo-care.com' && /Did Hilda's daughter Rosa leave a Google review\?/.test(fu.title), fu)
  ck('...and no new suggestion for Hilda (asked in the last 90 days) or Carl (Not now)', !askOf('10').some((a) => a.status === 'suggested') && !askOf('11').some((a) => a.status === 'suggested'))
  r = await call({ action: 'sweep' }, null, job)
  ck('...the follow-up comes once', r.j.followups === 0 && cards('review_followup').length === 1)
  r = await call({ action: 'review_outcome', ask_id: hilda.ask_id, outcome: 'left' }, 'kr')
  ck('Left a review: recorded, the follow-up card closes', r.j.outcome === 'recorded' && T.review_ask.find((a) => a.ask_id === hilda.ask_id).outcome === 'left' && cards('review_followup')[0].status === 'done')
  r = await call({ action: 'review_suggest', axiscare_client_id: '22' }, 'kr')
  ck('a person can choose to ask, but never a deceased, past or paused client', r.j.outcome === 'refused' && (await call({ action: 'review_suggest', axiscare_client_id: '21' }, 'kr')).j.outcome === 'refused' && (await call({ action: 'review_suggest', axiscare_client_id: '20' }, 'kr')).j.outcome === 'refused')
  r = await call({ action: 'review_suggest', axiscare_client_id: '10' }, 'kr')
  ck('...nor someone asked in the last 90 days', r.j.outcome === 'refused' && /90 days/.test(r.j.error))
  r = await call({ action: 'review_suggest', axiscare_client_id: '25', who: 'Opal\'s son', note: 'He thanked us for sorting out the late caregiver' }, 'an')
  ck('...a current client: a suggestion with the message ready (no card; the person is already there)', r.j.outcome === 'suggested' && /Caring Companions/.test(r.j.message) && r.j.ask.moment === 'manual')
  r = await call({ action: 'review_counts' }, 'an')
  ck('counts are for owners', r.status === 403)
  r = await call({ action: 'review_counts' }, 'sam')
  ck('...owners see suggested, asked, left (last 90 days)', r.j.asked >= 1 && r.j.left === 1 && r.j.not_now >= 1, r.j)
  r = await call({ action: 'review_state', axiscare_client_id: '10' }, 'sal')
  ck('any office role can read it (Staffing included); signed out cannot', r.status === 200 && (await call({ action: 'review_state', axiscare_client_id: '10' }, null)).status === 401)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
