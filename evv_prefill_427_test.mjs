// 427 · the pre-filled, visit-linked EVV correction form.
//   node evv_prefill_427_test.mjs                                        scans, the helper, the REAL senders against fakes,
//                                                                        the AxisCare check, the form's pre-fill logic
//   PGLITE=<path to @electric-sql/pglite> node evv_prefill_427_test.mjs  also runs 422 + 427 SQL (twice) and the proof in Postgres
import fs from 'fs'; import path from 'path'; import vm from 'vm'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
const DASH = /[\u2014\u2015]/
const FN = 'supabase/functions'
const sq = fs.readFileSync('evv_prefill_427.sql', 'utf8'), pf = fs.readFileSync('evv_prefill_427_proof.sql', 'utf8')
const helper = fs.readFileSync(`${FN}/_shared/evv-prefill.ts`, 'utf8')
/* 2026-10-17: the public form page now only says the form is retired (evv_retired_test.mjs); its 427 pre-fill code is
   checked on its last full version */
const form = (await import('child_process')).execSync('git show b68665a:evv-correction-form.html', { encoding: 'utf8', maxBuffer: 64e6 })
const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ── 1 · scans ──
const body = sq.replace(/--[^\n]*/g, '')
ck('SQL: one transaction (begin ... commit), nothing after commit', /^\s*begin;/m.test(body) && body.trim().endsWith('commit;') && (body.match(/\bcommit;/g) || []).length === 1)
const grants = [...body.matchAll(/\bgrant\b([^;]*)\bon\b\s+(function\s+)?([\w.]+)[^;]*\bto\b([^;]*);/gi)].map((m) => ({ what: m[1].trim(), on: m[3], to: m[4].trim() }))
ck('SQL: never a blanket GRANT: only evv_prefill (staff select, server select/insert/update) and EXECUTE on the two functions to anon + authenticated',
  !/all\s+tables/i.test(body) && !/all\s+functions/i.test(body) && !/\bto\s+public\b/i.test(body) && grants.length === 4
  && grants.some((g) => g.on === 'public.evv_prefill' && g.what === 'select' && g.to === 'authenticated')
  && grants.some((g) => g.on === 'public.evv_prefill' && g.what === 'select, insert, update' && g.to === 'service_role')
  && grants.filter((g) => /^public\.evv_(prefill_get|submit_prefilled)$/.test(g.on) && g.what === 'execute' && g.to === 'anon, authenticated').length === 2, grants)
ck('SQL: anon gets nothing on evv_prefill; signed-in accounts can only read it', /revoke all on public\.evv_prefill from anon;/.test(body) && /revoke all on public\.evv_prefill from authenticated;/.test(body)
  && /revoke all on public\.evv_prefill from public;/.test(body) && /enable row level security/.test(body))
ck('SQL: the two functions are security definer with a fixed search_path, and taken away from "public" before granting',
  (body.match(/security definer\s*\n\s*set search_path = pg_catalog, public/g) || []).length === 2
  && /revoke all on function public\.evv_prefill_get\(uuid\) from public;/.test(body) && /revoke all on function public\.evv_submit_prefilled\(uuid, jsonb\) from public;/.test(body))
ck('SQL: the submit takes who and which visit FROM THE ROW (r.), never from the payload', /r\.caregiver_axiscare_id, r\.caregiver_name, r\.client_axiscare_id/.test(body) && /'axiscare-visit', now\(\), r\.axiscare_visit_id/.test(body)
  && !/p_payload->>'(caregiver_axiscare_id|client_axiscare_id|axiscare_visit_id|attendant|consumer|visitdate|processed|outcome|linked_by)'/.test(body))
ck('SQL: both signatures are required (PNG data images) and every answer has a length limit', /v_sa !~ v_sig/.test(body) && /v_sc !~ v_sig/.test(body)
  && /length\(v_reason\) > 300/.test(body) && /length\(v_notes\) > 4000/.test(body) && /length\(v_tasks\) > 2000/.test(body))
ck('SQL: the get returns only the allowed words', (() => { const m = body.match(/'status', 'ok',([\s\S]*?)\);/); const keys = m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : []
  return JSON.stringify(keys.sort()) === JSON.stringify(['actual_in', 'actual_out', 'caregiver_name', 'client_display', 'scheduled_in', 'scheduled_out', 'visit_date', 'which_missing']) })())
ck('SQL: the 422 guard and the plain public form are not changed', !/evv_submissions_public_insert_guard/.test(body) && !/(grant|revoke)[^;]*on public\.evv_submissions/i.test(body))
ck('SQL: nothing is deleted or truncated', !/\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i.test(body.replace(/'[A-Z]+'/g, '')))
ck('no em dashes in anything 427 added (SQL, proof, helper)', !DASH.test(sq) && !DASH.test(pf) && !DASH.test(helper))

// the form: what 427 added has no em dashes; the blank form's own path is unchanged
{ const added = form.slice(form.indexOf('/* EVVPRE:start'), form.indexOf('// ── Signature canvases'))
  const box = (form.match(/<div class="pre-box"[^\n]*\n/) || [''])[0] + (form.match(/\.pre-box[\s\S]*?\.pre-blank-btn\{[^}]*\}/) || [''])[0]
  const sub = form.slice(form.indexOf('if (PRE.token && PRE.info) {'), form.indexOf('} else {', form.indexOf('if (PRE.token && PRE.info) {')))
  ck('form: no em dashes in the 427 parts (pre-fill logic, the box, the submit branch, the lock notes)', !DASH.test(added) && !DASH.test(box) && !DASH.test(sub)
    && !DASH.test((form.match(/<div class="lock-note"[^\n]*/g) || []).join('')), [DASH.test(added), DASH.test(box), DASH.test(sub)])
  ck('form: without a link the blank form saves exactly as before (plain insert into evv_submissions)', /const \{ error \} = await sb\.from\('evv_submissions'\)\.insert\(\[payload\]\);/.test(form))
  ck('form: with a link it saves through evv_submit_prefilled with only the token and the answers', /sb\.rpc\('evv_submit_prefilled', \{ p_token: PRE\.token, p_payload: payload \}\)/.test(form)
    && /sb\.rpc\('evv_prefill_get', \{ p_token: PRE\.token \}\)/.test(form))
  ck('form: the client signature is still required', /hasSig2/.test(form) && /Client signature required/.test(form)) }

// ── 2 · the helper ──
const H = await import(path.join(process.cwd(), FN, '_shared/evv-prefill.ts'))
ck('helper: the client is first name + last initial only', H.clientDisplay('Ruth', 'adams') === 'Ruth A.' && H.clientDisplay('Ruth', '') === 'Ruth' && H.clientDisplay('', '') === 'your client')
ck('helper: the link is the form address + the token, nothing else', H.prefillUrl('11111111-2222-4333-8444-555555555555') === 'https://sc.mo-care.com/evv-correction-form.html?t=11111111-2222-4333-8444-555555555555')
{ const m = "Hi Maria, to change your clock-in time we need the EVV correction form, filled out and signed by Ruth: sc.mo-care.com/evv-correction-form. We can't make any manual changes without it."
  const u = H.prefillUrl('11111111-2222-4333-8444-555555555555')
  ck('helper: only the link changes in the message; no link = unchanged; a message without the link gets nothing added',
    H.withPrefillLink(m, u) === m.replace('sc.mo-care.com/evv-correction-form', u) && H.withPrefillLink(m, null) === m && H.withPrefillLink('no link here', u) === 'no link here') }

// ── 3 · the REAL senders against fakes (the c1 harness) ──
let NOW = Date.parse('2026-09-30T14:00:00Z')
const RealDate = Date
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const at = (hm, day = '2026-09-30') => { NOW = RealDate.parse(`${day}T${hm}:00-05:00`) }
let APP, T, SENT, VISITS, CLIENTS, PREFAIL
const reset = () => {
  APP = { ops_settings: { timekeeper_watch_live: true, timekeeper_text_live: true, timekeeper_admin_loop_live: true, coverage_alert_admins: ['sam@mo-care.com', 'kry@mo-care.com'] },
    caregivers: [{ id: 1, first: 'Maria', last: 'Lopez', phone: '4175550111', axiscare_id: '501', active: true }],
    coordinator_staff: [{ email: 'sam@mo-care.com', name: 'Samantha T', phone: '4175550901' }, { email: 'kry@mo-care.com', name: 'Krystal L', phone: '4175550902' }],
    timekeeper_cases: [], coverage_cases: [], ops_items: [], automation_log: [] }
  T = { phone_index: [], contact_optout_current: [], circle_contacts: [], op_events: [], contact_send_refusals: [], evv_prefill: [] }
  SENT = []; PREFAIL = false
  VISITS = [{ id: 9001, caregiver: { id: 501, firstName: 'Maria', lastName: 'Lopez' }, client: { id: 701, firstName: 'Ruth', lastName: 'Adams' },
              scheduledStartDate: '2026-09-30T09:00:00', scheduledEndDate: '2026-09-30T13:00:00', clockIn: null, clockOut: null }]
  CLIENTS = [{ id: 701, firstName: 'Ruth', lastName: 'Adams', homePhone: '4175550777' }]
}
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, contains() { return b }, in() { return b }, is() { return b }, gte() { return b }, lte() { return b }, ilike() { return b }, not() { return b }, or() { return b }, neq() { return b },
  eq(c, v) { st.f.push([c, v]); return b },
  insert(row) { if (t === 'evv_prefill' && PREFAIL) return Promise.resolve({ data: null, error: { message: 'relation "evv_prefill" does not exist' } }); (T[t] ||= []).push(row); return Promise.resolve({ data: row, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })) },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]
      return Promise.resolve({ data: k in APP ? [{ key: k, data: JSON.parse(JSON.stringify(APP[k])) }] : [], error: null }).then(ok) }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    return Promise.resolve({ data: rows, error: null }).then(ok)
  } }; return b }
globalThis.__db = { from: q, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) },
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); const it = JSON.parse(JSON.stringify(a.item)); if (i >= 0) arr[i] = it; else arr.push(it) } return { data: null, error: null } } }
const PHONE_OF = {}
globalThis.fetch = async (url, o) => { url = String(url); const bd = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('axiscare.com/api/visits?')) return new Response(JSON.stringify({ results: { visits: JSON.parse(JSON.stringify(VISITS)), nextPage: null } }), { status: 200 })
  const vm2 = url.match(/axiscare\.com\/api\/visits\/(\d+)/); if (vm2) return new Response(JSON.stringify({ results: VISITS.find((v) => String(v.id) === vm2[1]) }), { status: 200 })
  if (url.includes('axiscare.com/api/clients?')) return new Response(JSON.stringify({ results: { clients: CLIENTS } }), { status: 200 })
  if (url.includes('/contacts/upsert')) { const id = 'C:' + (bd.phone || bd.email); PHONE_OF[id] = bd.phone || bd.email; return new Response(JSON.stringify({ contact: { id, dnd: false } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ to: PHONE_OF[bd.contactId] || bd.contactId, message: bd.message || '' }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
const SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', AXISCARE_API_KEY: 'ax' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
globalThis.__dbFor = () => ({ from: () => { const bb = { select() { return bb }, limit() { return Promise.resolve({ data: [], error: null }) } }; return bb } })
fs.writeFileSync(`${FN}/_shared/_job-auth_427t.ts`, fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)'))
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_427t.ts`) } catch { /* */ } })
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_427t.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t427.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) } return handler }
const TK = await load('timekeeper-watch'), CA = await load('clockin-alert')
const tick = async () => { const r = await TK(new Request('https://x/functions/v1/timekeeper-watch', { method: 'POST', headers: { Authorization: 'Bearer eyJanon', 'x-cron-secret': JOBSEC } })); return r.json() }
const page = async (bdy) => { const r = await CA(new Request('https://x/functions/v1/clockin-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bdy) })); return { s: r.status, j: await r.json().catch(() => null) } }
const to_ = (p) => SENT.filter((m) => String(m.to).replace(/\D/g, '').endsWith(p))
const toCg = () => to_('4175550111'), toSam = () => to_('4175550901')
const linkOf = (msg) => { const m = String(msg).match(/https:\/\/cc\.mo-care\.com\/clockin\.html\?c=([^&]+)&a=([0-9a-f]+)&e=(\d+)&t=([A-Za-z0-9_-]+)/); return m ? { c: decodeURIComponent(m[1]), a: m[2], e: Number(m[3]), t: m[4] } : null }
const EVVURL = /https:\/\/sc\.mo-care\.com\/evv-correction-form\.html\?t=([^\s.,]+(?:\.[^\s.,]+)*)/
const noPII = (url) => !/maria|lopez|ruth|adams|4175550|@|2026|501|701|9001/i.test(url) && new URL(url).searchParams.size === 1 && UUIDRE.test(new URL(url).searchParams.get('t'))

/* a · the missed clock-in: the caregiver's 5-minute text and the admin texts carry NO EVV form (her rule) */
reset(); at('09:05'); await tick()
ck('missed clock-in · the automatic caregiver text has no EVV form and no pre-fill is made', toCg().length === 1 && !/evv|correction/i.test(toCg()[0].message) && T.evv_prefill.length === 0, { sent: SENT, pre: T.evv_prefill })
ck('missed clock-in · no admin text carries an EVV form link', toSam().length >= 1 && SENT.every((m) => !/evv-correction/.test(m.message)), SENT)
at('09:30'); await tick()
ck('missed clock-in · later rounds still make no pre-fill and send no form', T.evv_prefill.length === 0 && SENT.every((m) => !/evv-correction/.test(m.message)), T.evv_prefill)

/* b-f · RETIRED 2026-10-17 (Samantha): the EVV correction form is no longer used. The tap is refused and sends nothing,
   the clock-out reminder carries no form link, and no pre-fill row is ever made. */
{ const L = linkOf(toSam()[0].message); const before = SENT.length
  const p = await page({ ...L, action: 'evv' })
  ck('retired tap · "Text the EVV form" is refused (410), nothing sent, no pre-fill row', p.s === 410 && p.j?.retired === true && SENT.length === before && T.evv_prefill.length === 0, p.j) }
reset(); VISITS[0].clockIn = { time: '2026-09-30T09:04:00' }; at('13:10'); await tick()
{ const m = toCg().at(-1)?.message || ''
  ck('clock-out reminder · one text, no form link, no pre-fill row', toCg().length === 1
    && m === "Hi Maria, it's Caring Companions. Your shift with Ruth ended at 1pm but there's no clock-out yet. Please clock out in the AxisCare app now. If you didn't put in your shift note, text it to the office now so we can put it in your shift for you."
    && T.evv_prefill.length === 0, m) }
reset(); VISITS[0].clockIn = { time: '2026-09-30T09:04:00' }; APP.ops_settings.timekeeper_msg_out = 'Hi {first_name}, clock out please. Form: sc.mo-care.com/evv-correction-form'; at('13:10'); await tick()
ck('clock-out reminder · an older saved wording with the form link is not sent; the standard wording goes', toCg().length === 1 && !/evv-correction/.test(toCg()[0].message) && /Please clock out in the AxisCare app now/.test(toCg()[0].message), toCg()[0])
reset(); VISITS[0].clockIn = { time: '2026-09-30T09:04:00' }; APP.ops_settings.timekeeper_msg_out = 'Hi {first_name}, please clock out for {client} ({time}).'; at('13:10'); await tick()
ck('clock-out reminder · her own wording without a link is still used as it is', toCg().length === 1 && toCg()[0].message === 'Hi Maria, please clock out for Ruth (1pm).', toCg()[0])
{ const ex = (rel) => { try { return String(fs.readFileSync(rel, 'utf8')) } catch { return '' } }
  const tk = ex(`${FN}/timekeeper-watch/index.ts`), ca = ex(`${FN}/clockin-alert/index.ts`)
  ck('source · neither sender makes a pre-fill or sends a form link any more', !/makePrefill|withPrefillLink|evv-prefill/.test(tk + ca)
    && !/sc\.mo-care\.com\/evv-correction-form/.test(tk.replace(/\/evv-correction-form\/i\.test/, '') + ca)) }

// ── 4 · the AxisCare check uses the form's own visit ──
{ const src = fs.readFileSync(`${FN}/evv-axiscare-check/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db2')
    .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES = []; const requireStaff = async () => ({ ok: true })')
  const tmp = path.join(process.cwd(), FN, 'evv-axiscare-check', '_t427.ts'); fs.writeFileSync(tmp, src)
  let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
  let ROW, UPD = []
  const db = { from: () => { let upd = null; const bb = { select() { return bb }, eq() { return bb }, update(x) { upd = x; return bb },
    maybeSingle() { return Promise.resolve({ data: ROW, error: null }) }, then(ok) { if (upd) UPD.push(upd); return Promise.resolve({ data: null, error: null }).then(ok) } }; return bb } }
  const V = (id, cin, cout) => ({ id, client: { id: 701 }, caregiver: { id: 501, firstName: 'Maria', lastName: 'Lopez' }, scheduledStartDate: '2026-09-30T09:00:00-05:00', scheduledEndDate: '2026-09-30T13:00:00-05:00',
    clockIn: cin ? { time: cin } : null, clockOut: cout ? { time: cout } : null })
  const two = [V(9001, '2026-09-30T09:00:00-05:00', '2026-09-30T13:00:00-05:00'), V(9002, null, null)]
  globalThis.fetch = async () => new Response(JSON.stringify({ results: { visits: two, nextPage: null } }), { status: 200 })
  ROW = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', visitdate: '2026-09-30', new_in: '09:00', new_out: '13:00', caregiver_axiscare_id: '501', client_axiscare_id: '701', axiscare_visit_id: '9001', axiscare_done_at: null }
  let r = await M.checkOne(db, ROW.id)
  ck('AxisCare check · a pre-filled form (it carries its visit) is checked against THAT visit, even with two visits that day', r.outcome === 'match' && r.visit?.id === '9001' && UPD[0]?.axiscare_visit_id === '9001', r)
  ROW = { ...ROW, axiscare_visit_id: null }; r = await M.checkOne(db, ROW.id)
  ck('AxisCare check · a form without a visit still asks the office to pick (unchanged)', r.outcome === 'several', r)
  ROW = { ...ROW, axiscare_visit_id: '9999' }; r = await M.checkOne(db, ROW.id)
  ck('AxisCare check · a stored visit no longer there falls back to the usual search', r.outcome === 'several', r) }

// ── 5 · the form's pre-fill logic (the real code from evv-correction-form.html) ──
{ const code = form.slice(form.indexOf('/* EVVPRE:start'), form.indexOf('/* EVVPRE:end */'))
  const ctx = { URLSearchParams, Date: RealDate, String, globalThis: {} }; vm.createContext(ctx); vm.runInContext(code + '\nglobalThis.EVVPRE = EVVPRE;', ctx)
  const E = ctx.globalThis.EVVPRE
  ck('form · reads the token from ?t= (any other address = the blank form)', E.token('?t=11111111-2222-4333-8444-555555555555') === '11111111-2222-4333-8444-555555555555'
    && E.token('') === null && E.token('?t=Maria') === null && E.token('?name=Maria&t=') === null && E.token('?t=11111111-2222-4333-8444-55555555555X') === null)
  const f = E.fields({ status: 'ok', caregiver_name: 'Maria Lopez', client_display: 'Ruth A.', visit_date: '2026-09-30', scheduled_in: '09:00', scheduled_out: '13:00', actual_in: null, actual_out: null, which_missing: 'in' })
  ck('form · fills the name, "Ruth A.", the date; corrected times start at the scheduled times', f.attendant === 'Maria Lopez' && f.consumer === 'Ruth A.' && f.visitdate === '2026-09-30'
    && f.new_in === '09:00' && f.new_out === '13:00' && f.orig_in === '' && f.line === 'Filled in for your visit with Ruth A. on Wednesday, September 30.', f)
  ck('form · says which clock is missing and the scheduled times, in words', /AxisCare is missing your clock-in\. The visit was scheduled 9:00 AM to 1:00 PM\./.test(f.detail), f.detail)
  const g = E.fields({ caregiver_name: 'Maria Lopez', client_display: 'Ruth A.', visit_date: '2026-09-30', scheduled_in: '09:00', scheduled_out: '13:00', actual_in: '09:04', which_missing: 'out' })
  ck('form · a missed clock-out: the original clock-in is what AxisCare shows, the corrected clock-in starts there too', g.orig_in === '09:04' && g.new_in === '09:04' && g.new_out === '13:00' && /missing your clock-out\..*AxisCare shows clock-in 9:04 AM\./.test(g.detail), g)
  ck('form · used / expired / unknown / failed links each say so and point to the blank form', /already used/.test(E.statusWords('used')) && /expired/.test(E.statusWords('expired'))
    && /not valid/.test(E.statusWords('not_found')) && /could not load/.test(E.statusWords(undefined)) && ['used', 'expired', 'not_found', undefined].every((s) => /form below/.test(E.statusWords(s))))
  ck('form · the save answer: saved = no message; used/expired offer the blank form; a refused answer names the box',
    E.submitWords({ ok: true }) === null && E.submitWords({ ok: false, error: 'used' }).blank === true && E.submitWords({ ok: false, error: 'expired' }).blank === true
    && /the client's signature/.test(E.submitWords({ ok: false, error: 'invalid', field: 'sig_consumer' }).msg) && E.submitWords(null).blank === false)
  ck('form · no em dashes in any words the pre-fill shows', ![f.line, f.detail, g.detail, ...['used', 'expired', 'not_found', 'x'].map(E.statusWords), ...['used', 'expired', 'not_found'].map((e) => E.submitWords({ error: e }).msg)].some((t) => DASH.test(t))) }

// ── 6 · the SQL and its proof in a real Postgres ──
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const s422 = fs.readFileSync('evv_forms_422.sql', 'utf8')
  for (const kind of ['text', 'time']) {
    const db = new PGlite()
    const tt = kind === 'time' ? 'time' : 'text'
    await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.evv_submissions (id uuid default gen_random_uuid() primary key, attendant text not null, consumer text not null, visitdate date not null,
  submitdate date, orig_in ${tt}, orig_out ${tt}, new_in ${tt}, new_out ${tt}, reason text, tasks text, notes text, sig_attendant text, sig_consumer text,
  processed boolean not null default false, processed_by text, processed_at timestamptz, submitted_at timestamptz not null default now());
alter table public.evv_submissions enable row level security;
grant select, insert, update, delete on public.evv_submissions to authenticated;
grant insert on public.evv_submissions to anon;
create policy "anon_insert_evv_submissions" on public.evv_submissions for insert to anon with check (true);
create policy "auth_select_evv_submissions" on public.evv_submissions for select to authenticated using (true);
create policy "auth_update_evv_submissions" on public.evv_submissions for update to authenticated using (true) with check (true);
insert into public.evv_submissions (attendant, consumer, visitdate, new_in, new_out, processed) values ('Old One', 'Client A', '2026-09-01', '08:00', '12:00', true);`)
    await db.exec(s422)
    let err = null
    try { await db.exec(sq); await db.exec(sq) } catch (e) { err = e.message }
    ck(`PGLITE (times as ${kind}): the SQL runs after 422, and runs again (idempotent)`, !err, err)
    const priv = async (role, p, obj = 'public.evv_prefill') => (await db.query(`select has_table_privilege('${role}', '${obj}', '${p}') as v`)).rows[0].v
    const fpriv = async (role, f) => (await db.query(`select has_function_privilege('${role}', '${f}', 'EXECUTE') as v`)).rows[0].v
    ck(`PGLITE (${kind}): anon has no table access; staff read only; the server writes`, !(await priv('anon', 'SELECT')) && !(await priv('anon', 'INSERT')) && await priv('authenticated', 'SELECT')
      && !(await priv('authenticated', 'INSERT')) && !(await priv('authenticated', 'UPDATE')) && await priv('service_role', 'INSERT'))
    ck(`PGLITE (${kind}): EXECUTE on the two functions for anon + authenticated; the plain form still insert-only`, await fpriv('anon', 'public.evv_prefill_get(uuid)') && await fpriv('anon', 'public.evv_submit_prefilled(uuid, jsonb)')
      && await fpriv('authenticated', 'public.evv_submit_prefilled(uuid, jsonb)') && await priv('anon', 'INSERT', 'public.evv_submissions') && !(await priv('anon', 'SELECT', 'public.evv_submissions')))
    const snap = async () => (await db.query(`select (select count(*) from public.evv_submissions)::int as n, (select count(*) from public.evv_prefill)::int as p,
      (select md5(coalesce(string_agg(to_jsonb(e)::text, '' order by id), '')) from public.evv_submissions e) as m`)).rows[0]
    const b4 = await snap()
    let probe = null
    try { await db.exec(pf) } catch (e) { probe = e.message }
    const J = probe && probe.includes('PROBE_RESULT: ') ? JSON.parse(probe.split('PROBE_RESULT: ')[1]) : null
    ck(`PGLITE proof (${kind}): anon cannot read or write the table`, J && J.anon_read_table === 'refused' && J.anon_insert_table === 'refused', J || probe)
    ck(`PGLITE proof (${kind}): the link gives ONLY the allowed words`, J && J.get?.status === 'ok' && JSON.stringify(J.get_keys) === JSON.stringify(['actual_in', 'actual_out', 'caregiver_name', 'client_display', 'scheduled_in', 'scheduled_out', 'status', 'visit_date', 'which_missing'])
      && J.get.client_display === 'Proof C.' && J.get.scheduled_in === '09:00' && J.get.actual_in === '09:12' && !('client_name' in J.get) && !('axiscare_visit_id' in J.get), J?.get)
    ck(`PGLITE proof (${kind}): no client signature = refused, and the link stays usable`, J && J.nosig?.ok === false && J.nosig?.field === 'sig_consumer' && J.submit?.ok === true, J && [J.nosig, J.submit])
    ck(`PGLITE proof (${kind}): the saved form is linked FROM THE ROW whatever the browser claimed, and waits for the office`, J && J.saved.found && J.saved.id_matches && J.saved.attendant === 'Proof427 Caregiver'
      && J.saved.consumer === 'Proof C.' && J.saved.visitdate === '2026-01-02' && J.saved.new_in === '09:00' && J.saved.processed === false && J.saved.outcome === null
      && J.saved.cg === 'proof427-cg' && J.saved.cl === 'proof427-cl' && J.saved.visit === 'proof427-visit' && J.saved.linked_by === 'axiscare-visit' && J.saved.cl_name === 'Proof427 Client' && J.saved.both_sigs, J?.saved)
    ck(`PGLITE proof (${kind}): one use (used link refused, get says used); expired refused; unknown = not_found`, J && J.again?.error === 'used' && J.get_used?.status === 'used' && J.get_expired?.status === 'expired'
      && J.submit_expired?.error === 'expired' && J.get_unknown?.status === 'not_found' && Object.keys(J.get_used).length === 1, J && [J.again, J.get_used, J.get_expired, J.submit_expired, J.get_unknown])
    ck(`PGLITE proof (${kind}): the link is marked used and points at the form`, J && J.link_used && J.link_points_to_form, J)
    ck(`PGLITE proof (${kind}): the plain public form still arrives unlinked whatever it claims (422 guard intact)`, J && J.plain_wiped === true, J)
    const af = await snap()
    ck(`PGLITE proof (${kind}): nothing stayed`, b4.n === af.n && b4.p === af.p && b4.m === af.m, [b4, af])
    // bad answers, as the public
    await db.exec(`insert into public.evv_prefill (token, axiscare_visit_id, caregiver_axiscare_id, caregiver_name, client_display, visit_date) values ('11111111-2222-4333-8444-555555555555', 'v', 'c', 'N', 'R A.', '2026-01-02')`)
    const sig = 'data:image/png;base64,iVBORw0KGgo='
    const good = { new_in: '09:00', new_out: '13:00', reason: 'Other', notes: 'x', sig_attendant: sig, sig_consumer: sig }
    const sub = async (pl) => { await db.exec('begin; set local role anon'); try { return (await db.query(`select public.evv_submit_prefilled('11111111-2222-4333-8444-555555555555', $1::jsonb) as r`, [JSON.stringify(pl)])).rows[0].r } catch (e) { return { thrown: e.message } } finally { await db.exec('rollback') } }
    const bads = [[{ ...good, new_in: '25:00' }, 'new_in'], [{ ...good, new_out: '' }, 'new_out'], [{ ...good, orig_in: 'noon' }, 'orig_in'], [{ ...good, reason: '' }, 'reason'], [{ ...good, reason: 'x'.repeat(301) }, 'reason'],
      [{ ...good, notes: 'x'.repeat(4001) }, 'notes'], [{ ...good, tasks: 'x'.repeat(2001) }, 'tasks'], [{ ...good, sig_attendant: 'javascript:alert(1)' }, 'sig_attendant'], [{ ...good, sig_consumer: '' }, 'sig_consumer'], [{ ...good, submitdate: 'today' }, 'submitdate']]
    const out = []; for (const [pl, fld] of bads) { const r = await sub(pl); out.push([fld, r]) }
    ck(`PGLITE (${kind}): every bad answer is refused by name (times, reason, what happened, tasks, signatures, date lengths/shapes)`, out.every(([fld, r]) => r && r.ok === false && r.field === fld), out)
    ck(`PGLITE (${kind}): a good answer saves`, (await sub(good))?.ok === true)
    await db.close()
  }
} else console.log('(PGLITE not set: the real-Postgres run of the SQL is skipped)')

const failed = res.filter((x) => !x[1])
for (const [n, ok, note] of res) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n      ' + note}`)
console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? ' · FAIL' : ''}`)
process.exit(failed.length ? 1 : 0)
