// PRN STEP 8a (Samantha 2026-10-29: "Yes, build step 8 (Gap Mentors) with its switches off"; renamed the same day: Field Support Visits). The rules
// (_shared/prn-mentor.ts), the REAL prn-week (naming, asking, assigning, with the REAL staff check) and the REAL prn-page
// (offers, answers, the note) against a fake database and a fake AxisCare, and the SQL on a throwaway Postgres when PGLITE is
// set. Nothing real is reached. node prn_mentor_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const M = await import(path.join(process.cwd(), F, '_shared/prn-mentor.ts'))
const PL = await import(path.join(process.cwd(), F, '_shared/prn-page-links.ts'))
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const day = (n) => new Date(Date.parse(TODAY + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)

/* ── 1. the rules ── */
ck('naming: PRN CNA Team only', !M.readMentor({ skills: ['hoyer'], evidence: 'refs from Mercy' }, 'caregiver').ok)
ck('...at least one verified skill, and how it was verified (online training alone is not enough)', !M.readMentor({ skills: [], evidence: 'refs' }, 'cna').ok && /Online training alone/.test(M.readMentor({ skills: ['hoyer'], evidence: '' }, 'cna').error))
ck('...unknown skills dropped; kept', JSON.stringify(M.readMentor({ skills: ['hoyer', 'surgery', 'hoyer'], evidence: 'References from Mercy, registry-checked CNA' }, 'cna').rec) === '{"on":true,"skills":["hoyer"],"evidence":"References from Mercy, registry-checked CNA"}')
ck('...taking it off is always allowed', M.readMentor({ on: false }, 'caregiver').ok)
const A = (o = {}) => ({ kind: 'refresher', client_ax: '501', client_name: 'Ruth Lane', visit_date: day(3), visit_time: '09:00-10:00', skill: 'hoyer', caregiver_ax: '77', caregiver_name: 'Amy Dale', family_ok: true, ...o })
ck('ask: a refresher needs the skill, the caregiver and the family\'s OK', M.readAsk(A(), TODAY).ok && !M.readAsk(A({ skill: '' }), TODAY).ok && !M.readAsk(A({ caregiver_ax: '' }), TODAY).ok && /family's OK/.test(M.readAsk(A({ family_ok: false }), TODAY).error))
ck('...a care update needs the family\'s OK, no caregiver or skill', M.readAsk(A({ kind: 'care_update', skill: '', caregiver_ax: '', caregiver_name: '' }), TODAY).ok && !M.readAsk(A({ kind: 'care_update', family_ok: false }), TODAY).ok)
ck('...a concern-only supervisory visit (decision 17) needs neither', M.readAsk(A({ kind: 'supervisory', skill: '', caregiver_ax: '', family_ok: false }), TODAY).ok)
ck('...a past date, no times, or an em dash: refused', !M.readAsk(A({ visit_date: day(-1) }), TODAY).ok && !M.readAsk(A({ visit_time: '10:00-09:00' }), TODAY).ok && !M.readAsk(A({ note: 'a — b' }), TODAY).ok)
const sup = M.readAsk(A({ kind: 'supervisory', skill: '', guide: true }), TODAY).ask
ck('...the caregiver is only kept on a refresher; GUIDE / VA ticks kept', sup.caregiver_ax === null && sup.guide === true && sup.va === false)
const visit = { id: 9, ...M.readAsk(A(), TODAY).ask, status: 'open' }
const mentor = (o = {}) => ({ name: 'Grace Hill', team: 'cna', axiscare_id: '11', prn: { gap_mentor: { on: true, skills: ['hoyer'] }, ...o } })
const V = (s, e) => ({ scheduledStartDate: `${day(3)}T${s}:00-05:00`, scheduledEndDate: `${day(3)}T${e}:00-05:00` })
ck('offered: approved for Field Support Visits with the skill, free then', M.mayOffer({ mentor: mentor(), visit, dnr: [], rows: [V('11:00', '13:00')] }).ok)
ck('...not approved for Field Support Visits, or not verified for the skill: no', !M.mayOffer({ mentor: { ...mentor(), prn: {} }, visit, dnr: [], rows: [] }).ok && !M.mayOffer({ mentor: mentor({ gap_mentor: { on: true, skills: ['dementia'] } }), visit, dnr: [], rows: [] }).ok)
ck('...a care update with no skill: anyone approved for Field Support Visits', M.mayOffer({ mentor: mentor({ gap_mentor: { on: true, skills: ['dementia'] } }), visit: { ...visit, kind: 'care_update', skill: null }, dnr: [], rows: [] }).ok)
ck('...on a break that day: no', M.mayOffer({ mentor: mentor({ break_until: day(5) }), visit, dnr: [], rows: [] }).why === 'on a break then')
ck('...Do Not Return for this client: no', M.mayOffer({ mentor: mentor(), visit, dnr: [{ client: 'Ruth Lane', caregiver: 'Grace Hill' }], rows: [] }).why === 'Do Not Return for this client')
ck('...working then in AxisCare (any overlap): no', M.mayOffer({ mentor: mentor(), visit, dnr: [], rows: [V('08:00', '09:30')] }).why === 'working then' && M.mayOffer({ mentor: mentor(), visit, dnr: [], rows: [V('10:00', '12:00')] }).ok)
ck("...AxisCare can't be read: not offered", M.mayOffer({ mentor: mentor(), visit, dnr: [], rows: null }).ok === false)
ck('...never the caregiver the refresher is with', !M.mayOffer({ mentor: { ...mentor(), axiscare_id: '77' }, visit, dnr: [], rows: [] }).ok)
const ov = M.offerView({ ...visit, note: 'She uses a Hoyer for bed to chair.' }, null, true)
ck('their page: the client\'s first name, the caregiver\'s first name, the skill; no last names', ov.client_first === 'Ruth' && ov.caregiver_first === 'Amy' && ov.skill === 'Hoyer lift transfers' && !/Lane|Dale/.test(JSON.stringify(ov)) && ov.familiar === true)
ck('...the rules they work by: never change the plan, diagnose or give medical advice; 911 first', /never change the care plan, diagnose or give medical advice/.test(M.MENTOR_RULES) && /call 911, then the office/.test(M.MENTOR_RULES))
ck('note: at least two parts, under 400 each, no em dash; comfort is yes / somewhat / no', !M.readReport('refresher', { practiced: 'Hoyer' }).ok && M.readReport('refresher', { practiced: 'Hoyer bed to chair', comfort: 'yes' }).ok
  && !M.readReport('refresher', { practiced: 'x', comfort: 'maybe' }).ok && !M.readReport('care_update', { mobility: 'a — b', eating: 'c' }).ok)
const now = '2026-11-03T18:00:00Z'
const lr = M.landing({ ...visit, visit_date: '2026-11-03' }, 'Grace Hill', { practiced: 'Hoyer', comfort: 'yes' }, now)
ck('a refresher goes on the caregiver\'s record: "Refresher with Grace (CNA), Nov 3: Hoyer lift transfers", hands-on', lr.kind === 'mentor_refresher' && lr.title === 'Refresher with Grace (CNA), Nov 3: Hoyer lift transfers' && lr.caregiver_ax === '77' && lr.hands_on === true, lr)
const lu = M.landing({ ...visit, kind: 'care_update', visit_date: '2026-11-03', guide: true }, 'Grace Hill', { mobility: 'Harder to stand', eating: 'Less' }, now)
ck("a care update goes to the client's Care plan reviews as \"What's changed\" (never a review: the 90-day clock is untouched)", lu.kind === 'mentor_report' && lu.title === "What's changed, from Grace (Field Support Visit), Nov 3" && lu.axiscare_client_id === '501')
ck('...GUIDE: share with their care navigator through Continuum; VA: check the authorization', /GUIDE care navigator through Continuum/.test(lu.reminder) && /VA authorization/.test(M.landing({ ...visit, kind: 'supervisory', va: true }, 'G', {}, now).reminder))
ck('switch: off by default; needs the page open', !M.mentorLive({}) && !M.mentorLive({ prn_mentor_live: true }) && M.mentorLive({ prn_mentor_live: true, prn_page_live: true }))
ck('no em dash and no "AI" in anything a member reads', ![M.MENTOR_RULES, ...Object.values(M.SKILLS), ...Object.values(M.KINDS).map((k) => k.label), ...M.UPDATE_FIELDS.flat(), ...M.REFRESHER_FIELDS.flat()].some((t) => /—|\bAI\b/.test(t)))

/* ── 2. a fake database ── */
let T, NOW_ID = 1000, AXIS = {}
const match = (x, f) => f.every(([op, c, v]) => op === 'eq' ? String(x[c]) === String(v) : op === 'in' ? v.map(String).includes(String(x[c])) : op === 'gte' ? String(x[c]) >= String(v)
  : op === 'isnull' ? x[c] == null : op === 'notnull' ? x[c] != null : true)
const q = (t) => { const st = { f: [], upd: null, ins: null }
  const rows = () => (T[t] ?? []).filter((x) => match(x, st.f))
  const done = () => { if (st.upd) { for (const x of rows()) Object.assign(x, st.upd); return { data: null, error: null } } return { data: JSON.parse(JSON.stringify(st.ins ?? rows())), error: null } }
  const b = { select() { return b }, order() { return b }, limit() { return b },
    eq(c, v) { st.f.push(['eq', c, v]); return b }, in(c, v) { st.f.push(['in', c, v]); return b }, gte(c, v) { st.f.push(['gte', c, v]); return b },
    is(c, v) { if (v === null) st.f.push(['isnull', c]); return b }, not(c, op, v) { if (op === 'is' && v === null) st.f.push(['notnull', c]); return b },
    update(o) { st.upd = o; return b },
    insert(row) { if (t === 'op_events') { T.op_events.push(row); st.ins = []; return b }
      const arr = (T[t] ||= []), list = Array.isArray(row) ? row : [row]
      st.ins = list.map((r) => { const x = { id: NOW_ID++, at: new Date().toISOString(), status: t === 'prn_mentor_visits' ? 'open' : undefined, ...r }; if (x.status === undefined) delete x.status; arr.push(x); return x }); return b },
    upsert(row, o) { const arr = (T[t] ||= []), keys = String(o?.onConflict || 'id').split(','); const i = arr.findIndex((x) => keys.every((k) => String(x[k]) === String(row[k])))
      if (i >= 0) Object.assign(arr[i], row); else arr.push({ id: NOW_ID++, ...row }); st.ins = []; return b },
    maybeSingle() { const d = done(); return Promise.resolve({ data: Array.isArray(d.data) ? (d.data[0] ?? null) : null, error: d.error }) },
    then(ok, bad) { return Promise.resolve(done()).then(ok, bad) } }; return b }
const APPS = { ops_items: [], care_plan_reviews: [] }
const db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APPS[a.target_key] ||= []); const i = arr.findIndex((x) => String(x.id) === String(a.item.id)); if (i >= 0) arr[i] = a.item; else arr.push(a.item) } return { data: null, error: null } },
  auth: { getUser: async (jwt) => jwt === 'kr' ? { data: { user: { id: 'u-kr', email: 'Krystal@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.__db = db
const appData = (k) => (k === 'ops_settings' ? T.settings : k === 'dnr_log' ? T.dnr : APPS[k] ?? null)
const G = '00000000-0000-4000-8000-000000000001', TI = '00000000-0000-4000-8000-000000000002', DE = '00000000-0000-4000-8000-000000000003'
const reset = (st = {}) => { NOW_ID = 1000; APPS.ops_items = []; APPS.care_plan_reviews = []; AXIS = {}
  T = { settings: { prn_page_live: true, ...st }, dnr: [], op_events: [], prn_mentor_visits: [], prn_mentor_answers: [], prn_page_log: [], prn_touches: [], prn_oncall: [], prn_shift_log: [],
    pay_tracks: [{ applicant_id: G, track: 'prn_team', team: 'cna', since: '2026-03-01', axiscare_caregiver_id: '11' }, { applicant_id: TI, track: 'prn_team', team: 'caregiver', since: '2026-03-01', axiscare_caregiver_id: '12' },
      { applicant_id: DE, track: 'prn_team', team: 'cna', since: '2026-03-01', axiscare_caregiver_id: '13' }],
    job_applicants: [{ id: G, first_name: 'Grace', last_name: 'Hill', prn: {} }, { id: TI, first_name: 'Tina', last_name: 'Shorr', prn: {} }, { id: DE, first_name: 'Denise', last_name: 'Gough', prn: {} }],
    auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }], persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }],
    entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'staffing_coordinator' }] }
  T.app_data = new Proxy([], { get: (a, k) => k === 'filter' ? (fn) => ['ops_settings', 'dnr_log', 'caregiver_availability', 'kind_tells', 'coverage_cases', 'client_checkins', 'caregivers'].map((key) => ({ key, data: appData(key) })).filter(fn) : a[k] }) }
globalThis.fetch = async (url) => { url = String(url)
  if (url.includes('/api/visits')) { const ax = new URL(url).searchParams.get('caregiverIds'); if (AXIS.down) return new Response('{}', { status: 503 }); return new Response(JSON.stringify({ results: { visits: (AXIS[ax] || []).map((v) => ({ caregiver: { id: Number(ax) }, ...v })) } }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', HUB_JOB_SECRET: 'S'.repeat(48), AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_gm_'))
const load = async (name) => { const src = fs.readFileSync(path.join(F, name, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, name + '.ts'), src); await import(path.join(tmp, name + '.ts') + '?' + Math.random()); return handler }
try {
  const week = await load('prn-week'), page = await load('prn-page')
  const W = async (body, jwt = 'kr') => { const r = await week(new Request('https://x/', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
  const LK = async (aid) => Object.fromEntries(new URL(await PL.makePageLink(ENV.HUB_JOB_SECRET, aid, PL.pageExpiry())).searchParams)
  const Pg = async (aid, body) => { const r = await page(new Request('https://x/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(await LK(aid)), ...body }) })); return { s: r.status, j: await r.json() } }

  reset(); let r = await W({ action: 'mentor_set', applicant_id: G, on: true, skills: ['hoyer'], evidence: 'References from Mercy' }, null)
  ck('naming: refused without an office sign-in', r.s === 401)
  r = await W({ action: 'mentor_set', applicant_id: TI, on: true, skills: ['hoyer'], evidence: 'refs' }); ck('...a PRN Caregiver Team member: refused', r.s === 400)
  r = await W({ action: 'mentor_set', applicant_id: G, on: true, skills: ['hoyer', 'dementia'], evidence: 'References from Mercy, registry-checked CNA' })
  const gm = T.job_applicants[0].prn
  ck('...Grace named for Hoyer and dementia care, with how it was verified and by whom, kept with its history', r.j.outcome === 'saved' && gm.gap_mentor.on && gm.gap_mentor.skills.join() === 'hoyer,dementia' && gm.gap_mentor.by === 'Krystal Office' && gm.gap_mentor_history.length === 1, gm)
  await W({ action: 'mentor_set', applicant_id: DE, on: true, skills: ['dementia'], evidence: 'Past employer: Mercy memory care' })
  r = await W({ action: 'mentor_ask', ...A() }); ck('asking, switch off: refused, nothing saved', r.s === 409 && !T.prn_mentor_visits.length, r.j)
  T.settings.prn_mentor_live = true; T.settings.prn_page_live = false
  r = await W({ action: 'mentor_ask', ...A() }); ck("...the page closed: refused (they couldn't see it)", r.s === 409 && /isn't open yet/.test(r.j.error))
  T.settings.prn_page_live = true
  r = await W({ action: 'mentor_ask', ...A({ family_ok: false }) }); ck("...a refresher without the family's OK: refused", r.s === 400)
  r = await W({ action: 'mentor_ask', ...A() }); const vid = r.j.id
  ck('...asked: saved with who asked; nothing texted', r.j.outcome === 'asked' && T.prn_mentor_visits[0].asked_by === 'Krystal Office' && T.prn_mentor_visits[0].status === 'open', [r.j, T.prn_mentor_visits])
  AXIS = { 11: [V('11:00', '13:00')], 13: [] }
  r = await Pg(G, { action: 'view' })
  ck("Grace's page: the refresher in her Field Support Visits (she has the skill and is free then)", r.j.mentor && r.j.mentor.offers.length === 1 && r.j.mentor.offers[0].id === vid && r.j.mentor.offers[0].skill === 'Hoyer lift transfers' && r.j.mentor.skills.join() === 'Hoyer lift transfers,Dementia care', r.j.mentor)
  r = await Pg(DE, { action: 'view' }); ck("Denise's page: not offered (not verified for Hoyer)", r.j.mentor && r.j.mentor.offers.length === 0, r.j.mentor)
  r = await Pg(TI, { action: 'view' }); ck("Tina (PRN Caregiver Team): no Field Support Visit section", r.j.mentor === null)
  AXIS = { 11: [V('08:30', '09:30')] }; r = await Pg(G, { action: 'view' }); ck('Grace working then in AxisCare: not offered', r.j.mentor.offers.length === 0, r.j.mentor)
  AXIS = { down: true }; r = await Pg(G, { action: 'view' }); ck("AxisCare can't be read: not offered", r.j.mentor.offers.length === 0)
  r = await Pg(G, { action: 'mentor_answer', id: vid, answer: 'yes' }); ck("...and a yes then isn't saved (503)", r.s === 503 && !T.prn_mentor_answers.length)
  AXIS = { 11: [] }
  r = await Pg(G, { action: 'mentor_answer', id: vid, answer: 'yes' })
  ck('"I can do it": saved, and the office gets a card to pick who goes', r.j.ok && T.prn_mentor_answers.some((a) => a.applicant_id === G && a.answer === 'yes') && APPS.ops_items.some((i) => i.id === 'ops_gapmentor_' + vid && /Grace can do the Field Support Visit for Ruth/.test(i.title) && /non-billable/.test(i.detail)), [r.j, APPS.ops_items])
  r = await Pg(G, { action: 'mentor_answer', id: vid, answer: 'no' }); ck('..."Not this time" replaces it, and never counts against her', r.j.ok && /never counts against you/.test(r.j.message) && T.prn_mentor_answers.filter((a) => a.applicant_id === G).length === 1 && T.prn_mentor_answers[0].answer === 'no')
  await Pg(G, { action: 'mentor_answer', id: vid, answer: 'yes' })
  r = await W({ action: 'mentor_list', client_ax: '501' })
  ck("the client's Care tab: the ask, with Grace's yes", r.j.visits.length === 1 && r.j.visits[0].answers[0].name === 'Grace Hill' && r.j.visits[0].answers[0].answer === 'yes', r.j)
  r = await W({ action: 'mentor_assign', id: vid, applicant_id: TI }); ck('assign: only to someone approved for Field Support Visits', r.s === 409)
  r = await W({ action: 'mentor_assign', id: vid, applicant_id: G }); ck('...Grace: recorded with who and when (it goes in AxisCare by hand)', r.j.outcome === 'assigned' && T.prn_mentor_visits[0].status === 'assigned' && T.prn_mentor_visits[0].assigned_to === G && T.prn_mentor_visits[0].assigned_by === 'Krystal Office')
  r = await W({ action: 'mentor_assign', id: vid, applicant_id: G }); ck('...twice: refused', r.s === 409)
  r = await Pg(G, { action: 'view' }); const mine = r.j.mentor.mine[0]
  ck("her page: the visit is hers; the note opens on the day", mine && mine.id === vid && mine.note_due === false && !r.j.mentor.offers.length, r.j.mentor)
  r = await Pg(G, { action: 'mentor_note', id: vid, practiced: 'x', comfort: 'yes' }); ck('...a note before the day: refused', r.s === 409 && /opens on the day/.test(r.j.error))
  T.prn_mentor_visits[0].visit_date = TODAY
  r = await Pg(DE, { action: 'mentor_note', id: vid, practiced: 'x', comfort: 'yes' }); ck('...someone else\'s visit: refused', r.s === 409)
  r = await Pg(G, { action: 'mentor_note', id: vid, practiced: 'Hoyer from bed to chair, twice', comfort: 'yes', repeat: 'Check the sling size next time' })
  const ref = APPS.care_plan_reviews.find((x) => x.kind === 'mentor_refresher')
  ck("the note: the visit is done; the refresher is on Amy's record, hands-on, apart from online courses", r.j.ok && T.prn_mentor_visits[0].status === 'done' && ref && ref.caregiver_ax === '77' && /^Refresher with Grace \(CNA\), \w+ \d+: Hoyer lift transfers$/.test(ref.title) && ref.report.practiced === 'Hoyer from bed to chair, twice', [r.j, ref])
  ck('...the office gets a card to read it', APPS.ops_items.some((i) => i.id === 'ops_gapnote_' + vid && /Read Grace's note/.test(i.title) && /on Amy Dale's record/.test(i.detail)))
  r = await Pg(G, { action: 'mentor_note', id: vid, practiced: 'again', comfort: 'no' }); ck('...once in, it stays as written', r.s === 409 && ref.report.practiced === 'Hoyer from bed to chair, twice')
  r = await Pg(G, { action: 'view' }); ck('...and her first Field Support Visit shows in her thank-yous', r.j.thanks.some((x) => x.text === 'Your first Field Support Visit. Thank you for helping our caregivers and families.'))
  /* a care update for a GUIDE client */
  r = await W({ action: 'mentor_ask', ...A({ kind: 'care_update', skill: '', caregiver_ax: '', caregiver_name: '', guide: true, visit_date: TODAY, visit_time: '20:00-21:00' }) })
  const cu = r.j.id; AXIS = { 13: [] }
  await Pg(DE, { action: 'mentor_answer', id: cu, answer: 'yes' }); await W({ action: 'mentor_assign', id: cu, applicant_id: DE })
  r = await Pg(DE, { action: 'mentor_note', id: cu, mobility: 'Needs two people to stand now', eating: 'Eating about half', safety: 'Rug in the hallway' })
  const rep = APPS.care_plan_reviews.find((x) => x.kind === 'mentor_report')
  ck("a care update: \"What's changed\" in Ruth's Care plan reviews, with the GUIDE reminder; the coordinator decides", r.j.ok && rep && rep.axiscare_client_id === '501' && /^What's changed, from Denise \(Field Support Visit\)/.test(rep.title) && /GUIDE care navigator through Continuum/.test(rep.reminder)
    && APPS.ops_items.some((i) => i.id === 'ops_gapnote_' + cu && i.urgency === 'high' && /Care Coordinator decides any care plan change/.test(i.detail)), [rep, APPS.ops_items])
  r = await W({ action: 'mentor_cancel', id: cu }); ck('a visit that happened cannot be cancelled', r.s === 409)
  T.settings.prn_mentor_live = false; r = await Pg(G, { action: 'mentor_answer', id: vid, answer: 'yes' }); ck('switched off: answers refused', r.s === 409)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

/* ── 3. the SQL ── */
const sql = fs.readFileSync('prn_mentor.sql', 'utf8')
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const pg = new PGlite()
  await pg.exec(`create table public.job_applicants (id uuid primary key); insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001');`)
  try { await pg.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch {}
  await pg.exec('begin;' + sql + 'commit;'); await pg.exec('begin;' + sql + 'commit;')
  const A1 = "'00000000-0000-0000-0000-000000000001'"
  let noCg = false; try { await pg.query(`insert into public.prn_mentor_visits (kind, client_ax, client_name, visit_date, visit_time, skill, family_ok, asked_by) values ('refresher', '501', 'Ruth', '2026-11-03', '09:00-10:00', 'hoyer', true, 'K')`) } catch { noCg = true }
  let noFam = false; try { await pg.query(`insert into public.prn_mentor_visits (kind, client_ax, client_name, visit_date, visit_time, asked_by) values ('care_update', '501', 'Ruth', '2026-11-03', '09:00-10:00', 'K')`) } catch { noFam = true }
  await pg.query(`insert into public.prn_mentor_visits (kind, client_ax, client_name, visit_date, visit_time, asked_by) values ('supervisory', '501', 'Ruth', '2026-11-03', '09:00-10:00', 'K')`)
  let noWho = false; try { await pg.query(`update public.prn_mentor_visits set status = 'assigned'`) } catch { noWho = true }
  await pg.query(`update public.prn_mentor_visits set status = 'done', assigned_to = ${A1}, report = '{"observed":"ok"}', report_at = now()`)
  let kept = false; try { await pg.query(`update public.prn_mentor_visits set report = '{"observed":"changed"}'`) } catch { kept = true }
  let noDel = false; try { await pg.query(`delete from public.prn_mentor_visits`) } catch { noDel = true }
  await pg.query(`insert into public.prn_mentor_answers (visit_id, applicant_id, answer) select id, ${A1}, 'yes' from public.prn_mentor_visits`)
  let twice = false; try { await pg.query(`insert into public.prn_mentor_answers (visit_id, applicant_id, answer) select id, ${A1}, 'no' from public.prn_mentor_visits`) } catch { twice = true }
  const g = (await pg.query(`select has_table_privilege('authenticated', 'public.prn_mentor_visits', 'select') r, has_table_privilege('authenticated', 'public.prn_mentor_visits', 'insert') w, has_table_privilege('anon', 'public.prn_mentor_answers', 'select') a`)).rows[0]
  ck("SQL: runs twice; a refresher needs the caregiver, a care update the family's OK, an assigned visit a mentor", noCg && noFam && noWho, { noCg, noFam, noWho })
  ck('SQL: a note stays as written; visits are kept; one answer per mentor per visit', kept && noDel && twice, { kept, noDel, twice })
  ck('SQL: office staff read; only the server writes; the public gets nothing', g.r === true && g.w === false && g.a === false, g)
} else ck('SQL on a throwaway Postgres (skipped: PGLITE not set)', true)

const fails = res.filter((r) => !r[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
