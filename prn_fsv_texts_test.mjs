// FIELD SUPPORT VISITS · THE TEXT (Samantha 2026-10-31: "manually put in a field Support request that will show up on the PRNs
// little hub and will text them just like an open shift"). The wording (_shared/prn-mentor.ts), the REAL prn-week (mentor_ask
// with text, mentor_text, mentor_list) with the REAL staff check and the REAL outbound gate, against a fake database, a fake
// AxisCare and a fake GoHighLevel; the SQL on a throwaway Postgres when PGLITE is set. Nothing real is reached.
// node prn_fsv_texts_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const M = await import(path.join(process.cwd(), F, '_shared/prn-mentor.ts'))
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const day = (n) => new Date(Date.parse(TODAY + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const A = (o = {}) => ({ kind: 'refresher', client_ax: '501', client_name: 'Ruth Lane', visit_date: day(3), visit_time: '09:00-10:00', skill: 'hoyer', caregiver_ax: '77', caregiver_name: 'Amy Dale', family_ok: true, ...o })
const V = (s, e, d = day(3)) => ({ scheduledStartDate: `${d}T${s}:00-05:00`, scheduledEndDate: `${d}T${e}:00-05:00` })

/* ── 1. the words ── */
const v0 = { id: 5, ...A(), visit_date: '2026-11-05', visit_time: '10:00-11:30' }
const tx = M.mentorText(null, 'Grace', v0, 'https://cc.mo-care.com/prn.html?p=x#mentor')
ck('the text: first names only, what, when, their page link, no pressure', tx === "Hi Grace, it's Caring Companions. A Field Support Visit is open: a Hoyer lift transfers refresher with Amy at Ruth's home, Thu Nov 5, 10am to 11:30am. Can you do it? Tap to say yes or not this time: https://cc.mo-care.com/prn.html?p=x#mentor No pressure either way.", tx)
ck('...a care update and a supervisory visit', M.whatWords({ kind: 'care_update', client_name: 'Ruth Lane' }) === 'a care update visit with Ruth' && M.whatWords({ kind: 'supervisory', client_name: 'Ruth Lane' }) === 'a supervisory visit with Ruth')
ck('...her own wording when she sets one', M.mentorText('Hi {first_name}: {what} {when} {link}', 'Grace', { kind: 'care_update', client_name: 'Ruth', visit_date: '2026-11-05', visit_time: '13:00-14:00' }, 'L') === 'Hi Grace: a care update visit with Ruth Thu Nov 5, 1pm to 2pm L')
ck('...no em dash, no "AI", no last names, no pay', !/—|\bAI\b|Lane|Dale|\$/.test(tx))
ck('switch: off by default; needs Field Support Visits and the page on', !M.mentorTextLive({ prn_mentor_live: true, prn_page_live: true }) && M.mentorTextLive({ prn_mentor_text_live: true, prn_mentor_live: true, prn_page_live: true }) && !M.mentorTextLive({ prn_mentor_text_live: true, prn_page_live: true }))
const NOWD = '2026-11-05'
ck('working right now: clocked in and not out, or scheduled now', M.workingNow([{ scheduledStartDate: `${NOWD}T08:00:00`, scheduledEndDate: `${NOWD}T12:00:00`, clockIn: { time: `${NOWD}T08:02:00` } }], `${NOWD}T10:00`)
  && M.workingNow([{ scheduledStartDate: `${NOWD}T09:00:00`, scheduledEndDate: `${NOWD}T11:00:00` }], `${NOWD}T10:00`)
  && !M.workingNow([{ scheduledStartDate: `${NOWD}T13:00:00`, scheduledEndDate: `${NOWD}T15:00:00` }], `${NOWD}T10:00`)
  && !M.workingNow([{ scheduledStartDate: `${NOWD}T06:00:00`, scheduledEndDate: `${NOWD}T08:00:00`, clockIn: { time: `${NOWD}T06:00:00` }, clockOut: { time: `${NOWD}T08:00:00` } }], `${NOWD}T10:00`))

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
  T = { settings: { prn_page_live: true, ...st }, dnr: [], op_events: [], prn_mentor_visits: [], prn_mentor_answers: [], prn_mentor_texts: [], prn_page_log: [], prn_touches: [], prn_oncall: [], prn_shift_log: [],
    pay_tracks: [{ applicant_id: G, track: 'prn_team', team: 'cna', since: '2026-03-01', axiscare_caregiver_id: '11' }, { applicant_id: TI, track: 'prn_team', team: 'caregiver', since: '2026-03-01', axiscare_caregiver_id: '12' },
      { applicant_id: DE, track: 'prn_team', team: 'cna', since: '2026-03-01', axiscare_caregiver_id: '13' }],
    job_applicants: [{ id: G, first_name: 'Grace', last_name: 'Hill', phone: '4175550101', prn: {} }, { id: TI, first_name: 'Tina', last_name: 'Shorr', phone: '4175550102', prn: {} }, { id: DE, first_name: 'Denise', last_name: 'Gough', phone: '4175550103', prn: {} }],
    auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }], persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }],
    entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'staffing_coordinator' }] }
  T.app_data = new Proxy([], { get: (a, k) => k === 'filter' ? (fn) => ['ops_settings', 'dnr_log', 'caregiver_availability', 'kind_tells', 'coverage_cases', 'client_checkins', 'caregivers'].map((key) => ({ key, data: appData(key) })).filter(fn) : a[k] }) }
let SENT = [], FAILSEND = false
globalThis.fetch = async (url, o) => { url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/api/visits')) { const ax = new URL(url).searchParams.get('caregiverIds'); if (AXIS.down) return new Response('{}', { status: 503 }); return new Response(JSON.stringify({ results: { visits: (AXIS[ax] || []).map((v) => ({ caregiver: { id: Number(ax) }, ...v })) } }), { status: 200 }) }
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { if (FAILSEND) return new Response('{"message":"nope"}', { status: 400 }); SENT.push({ to: body.contactId, text: body.message, from: body.fromNumber }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const realTLS = Date.prototype.toLocaleString
let HOUR = '11'; Date.prototype.toLocaleString = function (loc, o) { return o && o.hour === '2-digit' && o.hour12 === false && !o.minute ? HOUR : realTLS.call(this, loc, o) }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: 'S'.repeat(48), AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_fsv_'))
const load = async (name) => { const src = fs.readFileSync(path.join(F, name, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, name + '.ts'), src); await import(path.join(tmp, name + '.ts') + '?' + Math.random()); return handler }
try {
  const week = await load('prn-week')
  const W = async (body, jwt = 'kr') => { const r = await week(new Request('https://x/', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
  const name = (who) => (who === G ? 'C:+14175550101' : who === DE ? 'C:+14175550103' : 'C:+14175550102')
  reset({ prn_mentor_live: true })
  await W({ action: 'mentor_set', applicant_id: G, on: true, skills: ['hoyer', 'dementia'], evidence: 'References from Mercy, registry-checked CNA' })
  await W({ action: 'mentor_set', applicant_id: DE, on: true, skills: ['dementia'], evidence: 'Past employer: Mercy memory care' })
  AXIS = { 11: [], 13: [] }
  let r = await W({ action: 'mentor_ask', ...A(), text: true })
  ck('a request with the text switch off: saved and on their pages, nothing texted, and it says so', r.j.outcome === 'asked' && T.prn_mentor_visits.length === 1 && !SENT.length && /switched off/.test(r.j.texts.held), r.j)
  T.settings.prn_mentor_text_live = true
  r = await W({ action: 'mentor_ask', ...A() })
  ck('...without "text": nothing texted', r.j.outcome === 'asked' && r.j.texts === null && !SENT.length)
  r = await W({ action: 'mentor_ask', ...A(), text: true }); const v1 = r.j.id
  ck('texted: Grace (approved for Hoyer, free then), from the office line, with her page link at Field Support Visits', r.j.texts.sent.join() === 'Grace Hill' && SENT.length === 1 && SENT[0].to === name(G) && SENT[0].from && /prn\.html\?p=.*#mentor/.test(SENT[0].text) && /Hoyer lift transfers refresher with Amy at Ruth's home/.test(SENT[0].text), [r.j, SENT])
  ck('...not Denise (not verified for Hoyer), with the reason; never Tina (PRN Caregiver Team)', r.j.texts.not.some((x) => x.name === 'Denise Gough' && /not verified/.test(x.why)) && !SENT.some((x) => x.to === name(TI)) && !JSON.stringify(r.j.texts).includes('Tina'), r.j.texts)
  ck('...recorded once, the link kept out of the record', T.prn_mentor_texts.length === 1 && T.prn_mentor_texts[0].visit_id === v1 && T.prn_mentor_texts[0].applicant_id === G && !/prn\.html\?p=/.test(T.prn_mentor_texts[0].message), T.prn_mentor_texts)
  r = await W({ action: 'mentor_text', id: v1 })
  ck('Text them again: Grace is never texted twice for the same visit', r.j.outcome === 'texted' && SENT.length === 1 && !r.j.texts.sent.length, r.j)
  SENT = []
  r = await W({ action: 'mentor_ask', ...A({ kind: 'care_update', skill: '', caregiver_ax: '', caregiver_name: '' }), text: true }); const v2 = r.j.id
  ck('a care update: both approved PRN CNAs texted (no skill needed)', r.j.texts.sent.sort().join() === 'Denise Gough,Grace Hill' && SENT.length === 2, r.j.texts)
  SENT = []; AXIS = { 11: [V('09:30', '11:00')], 13: [] }
  r = await W({ action: 'mentor_ask', ...A({ kind: 'supervisory', skill: '', caregiver_ax: '', caregiver_name: '', family_ok: false }), text: true })
  ck('never someone working then in AxisCare (her rule): Grace not texted, Denise is', r.j.texts.sent.join() === 'Denise Gough' && r.j.texts.not.some((x) => x.name === 'Grace Hill' && x.why === 'working then'), r.j.texts)
  SENT = []; AXIS = { 11: [], 13: [V('00:00', '23:59', TODAY)] }
  r = await W({ action: 'mentor_ask', ...A({ kind: 'supervisory', skill: '', caregiver_ax: '', caregiver_name: '', family_ok: false, visit_time: '14:00-15:00' }), text: true }); const v4 = r.j.id
  ck('never anyone working a shift right now, even when it does not overlap: Denise held with the reason', r.j.texts.sent.join() === 'Grace Hill' && r.j.texts.not.some((x) => x.name === 'Denise Gough' && /right now/.test(x.why)), r.j.texts)
  SENT = []; AXIS = { 11: [], 13: [] }
  r = await W({ action: 'mentor_text', id: v4 }); ck('...Text them later: now Denise, and only Denise', r.j.texts.sent.join() === 'Denise Gough' && SENT.length === 1, r.j)
  SENT = []; AXIS = { down: true }
  r = await W({ action: 'mentor_ask', ...A({ kind: 'supervisory', skill: '', caregiver_ax: '', caregiver_name: '', family_ok: false }), text: true })
  ck("AxisCare can't be read: nobody texted, and it says why", !SENT.length && r.j.texts.not.length === 2 && r.j.texts.not.every((x) => /AxisCare/.test(x.why)), r.j.texts)
  AXIS = { 11: [], 13: [] }; HOUR = '21'
  r = await W({ action: 'mentor_ask', ...A({ kind: 'supervisory', skill: '', caregiver_ax: '', caregiver_name: '', family_ok: false }), text: true }); const v6 = r.j.id
  ck('9pm: saved and on their pages, nothing texted, "tap Text them in the morning"', r.j.outcome === 'asked' && !SENT.length && /9pm and 8am/.test(r.j.texts.held), r.j)
  HOUR = '08'; r = await W({ action: 'mentor_text', id: v6 }); ck('...8am: Text them sends', r.j.texts.sent.length === 2 && SENT.length === 2, r.j)
  SENT = []; HOUR = '11'
  await W({ action: 'mentor_ask', ...A({ kind: 'supervisory', skill: '', caregiver_ax: '', caregiver_name: '', family_ok: false }) })
  const v7 = T.prn_mentor_visits[T.prn_mentor_visits.length - 1].id
  T.prn_mentor_answers.push({ visit_id: v7, applicant_id: G, answer: 'no' })
  r = await W({ action: 'mentor_text', id: v7 }); ck('someone who already answered on their page is not texted', r.j.texts.sent.join() === 'Denise Gough', r.j.texts)
  SENT = []; FAILSEND = true
  await W({ action: 'mentor_ask', ...A({ kind: 'supervisory', skill: '', caregiver_ax: '', caregiver_name: '', family_ok: false }) })
  const v8 = T.prn_mentor_visits[T.prn_mentor_visits.length - 1].id
  r = await W({ action: 'mentor_text', id: v8 }); FAILSEND = false
  ck("a text that fails: listed back, not recorded as texted (so Text them tries again)", r.j.texts.failed.length === 2 && !T.prn_mentor_texts.some((x) => x.visit_id === v8), r.j.texts)
  await W({ action: 'mentor_cancel', id: v8 })
  r = await W({ action: 'mentor_text', id: v8 }); ck('a cancelled request: refused', r.s === 409)
  r = await W({ action: 'mentor_text', id: v1 }, null); ck('Text them: office sign-in only', r.s === 401)
  r = await W({ action: 'mentor_list' })
  const l1 = r.j.visits.find((x) => x.id === v1)
  ck('the Field Support Visits tab: every open request from today on, who was texted, the switch and how many are approved', l1 && l1.texted.join() === 'Grace Hill' && r.j.text_live === true && r.j.approved === 2 && !r.j.visits.some((x) => x.id === v8) && /\{what\}/.test(r.j.text_default), r.j)
  T.prn_mentor_texts = undefined; delete T.prn_mentor_texts
} finally { fs.rmSync(tmp, { recursive: true, force: true }); Date.prototype.toLocaleString = realTLS }

ck('the sender is registered (outbound gate and "Didn\'t go through" wording)', /'prn-field-support':\s+\{ class: 'routine_internal', scheduled: false/.test(fs.readFileSync(F + '/_shared/outreach.ts', 'utf8'))
  && /'prn-field-support': \['Field Support Visit text to a PRN CNA', 'caregivers'\]/.test(fs.readFileSync(F + '/_shared/send-problems.ts', 'utf8')))

/* ── 3. the SQL ── */
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const pg = new PGlite()
  await pg.exec(`create table public.job_applicants (id uuid primary key); insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001');`)
  try { await pg.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch {}
  await pg.exec('begin;' + fs.readFileSync('prn_mentor.sql', 'utf8') + 'commit;')
  const sql = fs.readFileSync('prn_fsv_texts.sql', 'utf8'); await pg.exec('begin;' + sql + 'commit;'); await pg.exec('begin;' + sql + 'commit;')
  await pg.query(`insert into public.prn_mentor_visits (kind, client_ax, client_name, visit_date, visit_time, asked_by) values ('supervisory', '501', 'Ruth', '2026-11-03', '09:00-10:00', 'K')`)
  const A1 = "'00000000-0000-0000-0000-000000000001'"
  await pg.query(`insert into public.prn_mentor_texts (visit_id, applicant_id, message) select id, ${A1}, 'Hi' from public.prn_mentor_visits`)
  let twice = false; try { await pg.query(`insert into public.prn_mentor_texts (visit_id, applicant_id) select id, ${A1} from public.prn_mentor_visits`) } catch { twice = true }
  let kept = false; try { await pg.query(`update public.prn_mentor_texts set message = 'x'`) } catch { kept = true }
  let noDel = false; try { await pg.query(`delete from public.prn_mentor_texts`) } catch { noDel = true }
  const g = (await pg.query(`select has_table_privilege('authenticated', 'public.prn_mentor_texts', 'select') r, has_table_privilege('authenticated', 'public.prn_mentor_texts', 'insert') w, has_table_privilege('anon', 'public.prn_mentor_texts', 'select') a`)).rows[0]
  ck('SQL: runs twice; once per person per visit; kept as sent', twice && kept && noDel, { twice, kept, noDel })
  ck('SQL: office staff read; only the server writes; the public gets nothing', g.r === true && g.w === false && g.a === false, g)
} else ck('SQL on a throwaway Postgres (skipped: PGLITE not set)', true)

const fails = res.filter((r) => !r[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
