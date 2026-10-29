// PRN STEP 6 (Samantha 2026-10-28 decision 7; 2026-10-29 "continue"): the monthly PRN Team update, and the office's "Keep off
// the PRN page" tick (decision 13). The rules (_shared/prn-monthly.ts, prn-open.ts), the REAL prn-week with the REAL staff check,
// outbound gate and opt-out check against a fake database and fake GoHighLevel, the page's update, and the SQL on a throwaway
// Postgres when PGLITE is set. Nothing real is reached. node prn_monthly_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const P = await import(path.join(process.cwd(), F, '_shared/prn-monthly.ts'))
const O = await import(path.join(process.cwd(), F, '_shared/prn-open.ts'))
const realTLS = Date.prototype.toLocaleString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute && o.timeZone === 'America/Chicago' && globalThis.__clock) return globalThis.__clock; return realTLS.call(this, loc, o) }

/* ── 1. the rules ── */
ck('the update is about last month', P.lastMonth('2026-11-03') === '2026-10' && P.lastMonth('2027-01-15') === '2026-12')
const SHF = (cg, cs, d, kind = 'confirmed') => ({ axiscare_caregiver_id: cg, case_id: cs, shift_date: d, kind })
const cases = [{ id: 'c1', client: 'Ruth Lane', client_axiscare_id: '501' }, { id: 'c2', client: 'Ruth Lane', client_axiscare_id: '501' }, { id: 'c3', client: 'Mary Cole', client_axiscare_id: '502' }, { id: 'c4', client: 'Al Fox', client_axiscare_id: '503' }]
let f = P.monthFacts({ month: '2026-10', cases, members: [{ first: 'Tina', since: '2026-10-19' }, { first: 'Denise', since: '2026-10-19' }, { first: 'Grace', since: '2026-03-01' }],
  shifts: [SHF('11', 'c1', '2026-10-03'), SHF('12', 'c2', '2026-10-10'), SHF('11', 'c3', '2026-10-20'), SHF('11', 'c4', '2026-10-21'), SHF('11', 'c4', '2026-10-21', 'backed_out'), SHF('11', 'c3', '2026-09-30')] })
ck('facts: covered shifts in the month (a back-out doesn\'t count, last month\'s don\'t), for how many families', f.covered === 3 && f.families === 2, f)
ck('...word for word, about the whole team', f.lines[0] === 'In October our PRN Teams stepped in for 3 shifts, for 2 different families. Thank you for standing in the gap.', f.lines)
ck('...new members welcomed by first name', f.lines[1] === 'Welcome to our newest members, Denise and Tina!', f.lines)
ck('...no caregiver is named next to a number', !/Grace|Lane|Cole/.test(f.lines.join(' ')))
f = P.monthFacts({ month: '2026-10', cases, members: [], shifts: [] })
ck('a quiet month: a warm line, never "0 shifts"', f.lines.length === 1 && f.lines[0] === 'In October our PRN Teams were ready whenever a family needed us. Thank you for being there.', f.lines)
ck('one shift, one family: said right', P.monthFacts({ month: '2026-10', cases, members: [{ first: 'Tina', since: '2026-10-02' }], shifts: [SHF('11', 'c1', '2026-10-03')] }).lines.join(' | ')
  === 'In October our PRN Teams stepped in for 1 shift, for 1 family. Thank you for standing in the gap. | Welcome to our newest member, Tina!')
ck('what the office writes: an em dash is refused', !P.readDraft({ paragraph: 'Thank you — all' }).ok)
ck('...too long is refused', !P.readDraft({ paragraph: 'x'.repeat(701) }).ok && !P.readDraft({ paragraph: 'ok', tip: 'x'.repeat(301) }).ok)
ck('...kind word and tip are optional', JSON.stringify(P.readDraft({ paragraph: 'Thank you all.' })) === '{"ok":true,"paragraph":"Thank you all.","kind_word":null,"tip":null}')
ck('the text, word for word', P.monthlyText(null, 'Grace', '2026-10', 'L') === 'Hi Grace, the Caring Companions PRN Team update for October is on your PRN Team page: L Thank you for standing in the gap with us.')
ck('...her own wording from Settings wins', P.monthlyText('{first_name}: {month} {link}', 'Tina', '2026-10', 'L') === 'Tina: October L')
ck('no em dash and no "AI" in anything a member reads', ![P.MONTHLY_TEXT_DEFAULT, P.STEADY_LINE, ...P.monthFacts({ month: '2026-10', cases, members: [{ first: 'A', since: '2026-10-01' }], shifts: [SHF('1', 'c1', '2026-10-01')] }).lines].some((t) => /—|\bAI\b/.test(t)))
ck('switch: off by default; on, but the page closed: off; both: on', !P.monthlyLive({}) && !P.monthlyLive({ prn_monthly_live: true }) && P.monthlyLive({ prn_monthly_live: true, prn_page_live: true }))
ck('never 9pm to 8am', !P.sendHour(7) && P.sendHour(8) && P.sendHour(20) && !P.sendHour(21) && !P.sendHour(0))
const row = { month: '2026-10', sent_by: 'Samantha Troutman', sent_at: '2026-11-02T16:00:00Z', body: { facts: ['In October...'], paragraph: 'Thank you all.', kind_word: 'She was wonderful.', tip: null } }
const pu = P.pageUpdate(row, '2026-11-20')
ck('their page: the update, signed with a first name, with the steady-hours line', pu.title === 'Your PRN Team update for October' && pu.from === 'Samantha' && pu.paragraph === 'Thank you all.' && pu.kind_word === 'She was wonderful.' && pu.tip === null && /steady hours/.test(pu.steady), pu)
ck('...gone after 40 days; never before it was sent', P.pageUpdate(row, '2026-12-15') === null && P.pageUpdate({ ...row, sent_at: null }, '2026-11-03') === null)

/* ── 2. Keep off the PRN page (decision 13) ── */
const K = (id, o = {}) => ({ id, status: 'open', client: 'Ruth Lane', shift_date: '2026-11-02', shift_time: '09:00-13:00', asked: [], ...o })
ck('keep off the PRN page: ticked, never an open shift on anyone\'s page; unticked, as before', O.openCandidates([K('a'), K('b', { prn_page_off: true })], '11', '2026-10-29', '2026-10-29T10:00').map((c) => c.id).join() === 'a')
const cr = fs.readFileSync(`${F}/coverage-run/index.ts`, 'utf8')
ck("...and I'm Interested on it is refused (checked again at the tap)", /if \(prnOngoingCase\(kase\) \|\| prnKeptOff\(kase\)\) return jr/.test(cr))

/* ── 3. the real prn-week ── */
const GRACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TOM = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TASHA = 'cccccccc-cccc-cccc-cccc-cccccccccccc', OPTED = '4175550202'
let T, SENT, EVENTS, CALLS, NOW_ID = 1, CLOCK = '11'
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const reset = (settings = {}) => { SENT = []; EVENTS = []; CALLS = []; NOW_ID = 1; T = {
  app_data: [{ key: 'ops_settings', data: { prn_thanks_live: true, ...settings } }, { key: 'caregivers', data: [{ first: 'Grace', last: 'Lee', phone: '4175550101', axiscare_id: '11' }, { first: 'Tom', last: 'Ray', phone: OPTED, axiscare_id: '22' }] },
    { key: 'kind_tells', data: [] }, { key: 'caregiver_availability', data: [{ axiscare_id: '22', target_hours: 12 }] },
    { key: 'coverage_cases', data: [{ id: 'cv1', client: 'Linda Smith', shift_date: day(-2) }] }],
  pay_tracks: [{ applicant_id: GRACE, track: 'prn_team', team: 'cna', since: day(-60), axiscare_caregiver_id: '11' }, { applicant_id: TOM, track: 'prn_team', team: 'cna', since: day(-60), axiscare_caregiver_id: '22' },
    { applicant_id: TASHA, track: 'prn_team', team: 'caregiver', since: day(-5), axiscare_caregiver_id: null }],
  job_applicants: [{ id: GRACE, first_name: 'Grace', last_name: 'Lee', phone: '4175550101' }, { id: TOM, first_name: 'Tom', last_name: 'Ray', phone: OPTED }, { id: TASHA, first_name: 'Tasha', last_name: 'Fox', phone: '4175550303' }],
  prn_shift_log: [{ applicant_id: GRACE, axiscare_caregiver_id: '11', case_id: 'cv1', kind: 'confirmed', shift_date: day(-2), recorded_at: new Date().toISOString() }],
  prn_touches: [], prn_oncall: [],
  auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }, { auth_user_id: 'u-cg', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-cg' }],
  persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }, { person_id: 'p-cg', full_name: 'Cara Giver', active: true }],
  entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cg', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cg', entity: 'cc_ihs', role: 'caregiver' }],
  contact_optout_current: [{ address: '+1' + OPTED, channel: 'sms', opted_out: true, source: 'stop_text' }], phone_index: [], circle_contacts: [], op_events: [] } }
const q = (t) => { const st = { f: [], inF: null, nul: [], upd: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, not() { return b },
  upsert(row) { const arr = (T[t] ||= []); const i = arr.findIndex((x) => x.month === row.month); if (i >= 0) Object.assign(arr[i], row); else arr.push({ sent_at: null, sent_by: null, sent_count: 0, ...row }); return Promise.resolve({ data: null, error: null }) },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF = [c, v]; return b }, is(c, v) { if (v === null) st.nul.push(c); return b },
  update(o) { st.upd = o; return b },
  insert(row) { if (t === 'op_events') { EVENTS.push(row); return Promise.resolve({ data: null, error: null }) }
    const arr = (T[t] ||= [])
    if (t === 'prn_touches' && arr.some((x) => x.applicant_id === row.applicant_id && x.kind === row.kind && x.ref === row.ref)) return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } })
    if (t === 'prn_oncall' && row.kind === 'confirmed' && arr.some((x) => x.kind === 'confirmed' && !x.cancelled_at && x.applicant_id === row.applicant_id && x.start_date === row.start_date)) return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } })
    arr.push({ id: NOW_ID++, at: new Date().toISOString(), cancelled_at: null, ...row }); return Promise.resolve({ data: null, error: null }) },
  rows() { let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); if (st.inF) r = r.filter((x) => st.inF[1].includes(x[st.inF[0]])); for (const c of st.nul) r = r.filter((x) => x[c] == null); return r },
  maybeSingle() { return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows()[0] ?? null)), error: null }) },
  then(ok) { if (st.upd) { for (const x of b.rows()) Object.assign(x, st.upd); return Promise.resolve({ data: null, error: null }).then(ok) }
    return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows())), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (jwt) => jwt === 'kr' ? { data: { user: { id: 'u-kr', email: 'Krystal@mo-care.com', app_metadata: {} } }, error: null }
    : jwt === 'cg' ? { data: { user: { id: 'u-cg', email: 'cg@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async (url, o) => { url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}; CALLS.push(url)
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, text: body.message, from: body.fromNumber }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const LM = P.lastMonth(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }))
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_pm_'))
try {
  const src = fs.readFileSync(path.join(F, 'prn-week/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'prn-week.ts'), src); await import(path.join(tmp, 'prn-week.ts'))
  ENV.HUB_JOB_SECRET = 'S'.repeat(48)
  const call = async (body, jwt = 'kr') => { const r = await handler(new Request('https://x/functions/v1/prn-week', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  const setup = (st) => { reset(st); T.prn_monthly = []; T.prn_shift_log = [{ applicant_id: GRACE, axiscare_caregiver_id: '11', case_id: 'cv1', kind: 'confirmed', shift_date: LM + '-12' }]; globalThis.__clock = '11' }
  setup({}); let r = await call({ action: 'monthly' }, 'cg'); ck('monthly: a caregiver sign-in is refused', r.status === 403)
  r = await call({ action: 'monthly' })
  ck("monthly: last month's facts drafted from the records, switch off, nothing sent", r.status === 200 && r.j.month === LM && r.j.facts[0].startsWith('In ' + P.monthWord(LM) + ' our PRN Teams stepped in for 1 shift, for 1 family.') && r.j.live === false && r.j.members === 3 && !SENT.length, r.j)
  r = await call({ action: 'monthly', month: '2020-01' }); ck('...only last month', r.status === 400)
  r = await call({ action: 'monthly_save', month: LM, paragraph: 'Thank you — all', kind_word: '', tip: '' }); ck('save: an em dash is refused', r.status === 400 && !T.prn_monthly.length)
  r = await call({ action: 'monthly_save', month: LM, paragraph: 'Thank you for everything this month.', kind_word: 'She made Mom laugh.', tip: '' })
  ck('save: kept with the facts and who saved it', r.j.outcome === 'saved' && T.prn_monthly[0].body.paragraph === 'Thank you for everything this month.' && T.prn_monthly[0].body.kind_word === 'She made Mom laugh.' && T.prn_monthly[0].saved_by === 'Krystal Office' && T.prn_monthly[0].body.facts.length >= 1, [r.j, T.prn_monthly])
  r = await call({ action: 'monthly_send', month: LM }); ck('send, switch off: refused, nothing sent', r.status === 409 && r.j.outcome === 'off' && !SENT.length, r.j)
  T.app_data[0].data.prn_monthly_live = true
  r = await call({ action: 'monthly_send', month: LM }); ck("send, the page closed: refused (a link never goes to a closed page)", r.status === 409 && /isn't open yet/.test(r.j.error) && !SENT.length, r.j)
  T.app_data[0].data.prn_page_live = true; globalThis.__clock = '22'
  r = await call({ action: 'monthly_send', month: LM }); ck('send at 10pm: refused, nothing sent', r.status === 409 && r.j.outcome === 'night' && !SENT.length, r.j)
  globalThis.__clock = '11'
  r = await call({ action: 'monthly_send', month: LM })
  ck('send: Grace and Tasha get it; Tom asked for no texts and is listed back (not silent)', r.j.outcome === 'sent' && r.j.sent.sort().join() === 'Grace Lee,Tasha Fox' && r.j.refused.length === 1 && /Tom Ray/.test(r.j.refused[0]) && SENT.length === 2, [r.j, SENT])
  const g = SENT.find((x) => x.to === 'C:+14175550101' || /Grace/.test(x.text))
  ck('...each text: their first name, the month, their own page link, from the office number', g && new RegExp('^Hi Grace, the Caring Companions PRN Team update for ' + P.monthWord(LM) + ' is on your PRN Team page: https://cc\\.mo-care\\.com/prn\\.html\\?p=' + GRACE + '&e=\\d+&t=[\\w-]+ Thank you for standing in the gap with us\\.$').test(g.text) && g.from === '+14172348494', SENT)
  ck('...recorded per member without the link; the month marked sent by who, with the count', T.prn_touches.filter((x) => x.kind === 'monthly_sent' && x.ref === 'monthly:' + LM).length === 2 && T.prn_touches.every((x) => !/prn\.html/.test(x.message || ''))
    && T.prn_monthly[0].sent_by === 'Krystal Office' && !!T.prn_monthly[0].sent_at && T.prn_monthly[0].sent_count === 2, [T.prn_touches, T.prn_monthly])
  r = await call({ action: 'monthly_send', month: LM }); ck('a second tap: nobody is texted twice', r.j.sent.length === 0 && r.j.already === 2 && SENT.length === 2, r.j)
  r = await call({ action: 'monthly_save', month: LM, paragraph: 'Changed after.' }); ck('after it went out, it stays as sent', r.status === 409 && T.prn_monthly[0].body.paragraph === 'Thank you for everything this month.')
  r = await call({ action: 'monthly' }); ck('monthly afterwards: sent by, to 2 of 3', r.j.sent_by === 'Krystal Office' && r.j.sent_to === 2 && r.j.members === 3, r.j)
  setup({ prn_monthly_live: true, prn_page_live: true })
  r = await call({ action: 'monthly_send', month: LM }); ck('send with no paragraph saved: refused, nothing sent', r.status === 400 && !SENT.length, r.j)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

/* ── 4. the page shows it ── */
const pg = fs.readFileSync(`${F}/prn-page/index.ts`, 'utf8')
ck("their page: the last update sent, through pageUpdate (40 days); no table yet = none, nothing breaks", /from\('prn_monthly'\)\.select\('month, body, sent_by, sent_at'\)\.not\('sent_at', 'is', null\)/.test(pg) && /const update = um\.error \? null : pageUpdate\(/.test(pg) && /looking: lookingState\(plog\.data \?\? \[\], t\), update, offered/.test(pg))
const out = fs.readFileSync(`${F}/_shared/outreach.ts`, 'utf8'), sp = await import(path.join(process.cwd(), F, '_shared/send-problems.ts'))
ck('a refused or failed monthly text reads as "PRN Team monthly update text" on Needs Attention, and the sender is registered', sp.SENDER_WORDS['prn-monthly']?.[0] === 'PRN Team monthly update text' && /'prn-monthly':\s+\{ class: 'routine_internal'/.test(out))

/* ── 5. the SQL ── */
const sql = fs.readFileSync('prn_monthly.sql', 'utf8')
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key); create table public.app_data (key text primary key, data jsonb);
    create table public.job_postings (slug text primary key, description text);
    insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001');`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch {}
  for (const f2 of ['prn_week.sql', 'prn_familiar.sql', 'prn_welcome.sql', 'prn_page.sql', 'prn_page_texts.sql']) await db.exec(fs.readFileSync(f2, 'utf8'))
  await db.exec('begin;' + sql + 'commit;'); await db.exec('begin;' + sql + 'commit;')
  await db.query(`insert into public.prn_monthly (month, body, saved_by, saved_at) values ('2026-10', '{"paragraph":"a"}', 'K', now())`)
  await db.query(`update public.prn_monthly set body = '{"paragraph":"b"}' where month = '2026-10'`)
  await db.query(`update public.prn_monthly set sent_at = now(), sent_by = 'K', sent_count = 1 where month = '2026-10'`)
  let frozen = false; try { await db.query(`update public.prn_monthly set body = '{"paragraph":"c"}' where month = '2026-10'`) } catch { frozen = true }
  await db.query(`update public.prn_monthly set sent_count = 3 where month = '2026-10'`)
  let kept = false; try { await db.query(`delete from public.prn_monthly`) } catch { kept = true }
  let bad = false; try { await db.query(`insert into public.prn_monthly (month) values ('2026-13')`) } catch { bad = true }
  await db.query(`insert into public.prn_touches (applicant_id, kind, ref, by_email) values ('00000000-0000-0000-0000-000000000001', 'monthly_sent', 'monthly:2026-10', 'k')`)
  let twice = false; try { await db.query(`insert into public.prn_touches (applicant_id, kind, ref, by_email) values ('00000000-0000-0000-0000-000000000001', 'monthly_sent', 'monthly:2026-10', 'k')`) } catch { twice = true }
  const k = (await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'prn_touches_kind_check'`)).rows[0].d
  const g2 = (await db.query(`select has_table_privilege('authenticated', 'public.prn_monthly', 'select') r, has_table_privilege('authenticated', 'public.prn_monthly', 'update') w, has_table_privilege('anon', 'public.prn_monthly', 'select') a`)).rows[0]
  ck('SQL: runs twice; editable until sent, then stays as sent (the count can still go up); kept; months checked', frozen && kept && bad, { frozen, kept, bad })
  ck('SQL: one monthly text per member per month; every earlier kind still allowed', twice && /monthly_sent/.test(k) && /page_ready_sent/.test(k) && /welcome_call/.test(k) && /handled/.test(k))
  ck('SQL: office staff read; only the server writes; the public gets nothing', g2.r === true && g2.w === false && g2.a === false, g2)
} else ck('SQL on a throwaway Postgres (skipped: PGLITE not set)', true)

const fails = res.filter((r) => !r[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
