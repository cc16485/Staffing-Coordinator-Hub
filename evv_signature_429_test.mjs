// 429 · the client signature: at the shift, at the next visit, or verified by phone.
//   node evv_signature_429_test.mjs                                        scans, the helper, the REAL timekeeper against
//                                                                          fakes, both public pages run in a fake browser
//   PGLITE=<path to @electric-sql/pglite> node evv_signature_429_test.mjs  also runs 422 + 427 + 429 SQL (twice) and all
//                                                                          three proofs in Postgres
import fs from 'fs'; import path from 'path'; import vm from 'vm'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1400)])
const DASH = /[\u2014\u2015]/
const FN = 'supabase/functions'
const sq = fs.readFileSync('evv_signature_429.sql', 'utf8'), pf = fs.readFileSync('evv_signature_429_proof.sql', 'utf8')
const helperSrc = fs.readFileSync(`${FN}/_shared/evv-sign.ts`, 'utf8')
const form = fs.readFileSync('evv-correction-form.html', 'utf8'), signPage = fs.readFileSync('evv-client-sign.html', 'utf8')
const tkSrc = fs.readFileSync(`${FN}/timekeeper-watch/index.ts`, 'utf8')
const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PLAINLANG = new RegExp('pla' + 'in (lang' + 'uage|eng' + 'lish)', 'i')   // her banned phrase, spelled so this file never contains it

// ── 1 · scans ──
const body = sq.replace(/--[^\n]*/g, '')
ck('SQL: one transaction (begin ... commit), nothing after commit', /^\s*begin;/m.test(body) && body.trim().endsWith('commit;') && (body.match(/\bcommit;/g) || []).length === 1)
const grants = [...body.matchAll(/\bgrant\b([^;]*)\bon\b\s+(function\s+)?([\w.]+)[^;]*\bto\b([^;]*);/gi)].map((m) => ({ what: m[1].trim(), on: m[3], to: m[4].trim() }))
ck('SQL: never a blanket GRANT: evv_sign (staff select; server select/insert/update) and EXECUTE on the four functions only',
  !/all\s+tables/i.test(body) && !/all\s+functions/i.test(body) && !/\bto\s+public\b/i.test(body) && grants.length === 6
  && grants.some((g) => g.on === 'public.evv_sign' && g.what === 'select' && g.to === 'authenticated')
  && grants.some((g) => g.on === 'public.evv_sign' && g.what === 'select, insert, update' && g.to === 'service_role')
  && grants.filter((g) => /^public\.evv_(sign_get|sign_submit|submit_prefilled)$/.test(g.on) && g.what === 'execute' && g.to === 'anon, authenticated').length === 3
  && grants.some((g) => g.on === 'public.evv_client_phone_record' && g.what === 'execute' && g.to === 'authenticated'), grants)
ck('SQL: the phone record is for signed-in staff only (taken from public AND anon, granted to authenticated)', /revoke all on function public\.evv_client_phone_record\(uuid, jsonb\) from anon;/.test(body)
  && /revoke all on function public\.evv_client_phone_record\(uuid, jsonb\) from public;/.test(body) && !/evv_client_phone_record\(uuid, jsonb\) to anon/.test(body))
ck('SQL: anon gets nothing on evv_sign; signed-in accounts can only read it; row security on', /revoke all on public\.evv_sign from anon;/.test(body) && /revoke all on public\.evv_sign from authenticated;/.test(body)
  && /revoke all on public\.evv_sign from public;/.test(body) && /alter table public\.evv_sign enable row level security/.test(body))
ck('SQL: the four public/staff functions are security definer with a fixed search_path; the two guards are invoker',
  (body.match(/security definer\s*\n\s*set search_path = pg_catalog, public/g) || []).length === 4 && (body.match(/security invoker\s*\n\s*set search_path = pg_catalog, public/g) || []).length === 2)
ck('SQL: the 422 insert guard keeps every wipe it had, and now also decides the signature status and wipes any phone record',
  ['new.processed := false', 'new.outcome := null', 'new.caregiver_axiscare_id := null', 'new.client_axiscare_id := null', 'new.linked_by := null', 'new.axiscare_visit_id := null', 'new.axiscare_done_at := null',
   "new.client_sig_status := 'waiting'", "new.client_sig_status := 'signed'", 'new.phone_verified_by := null', 'new.phone_verified_confirmed := null', 'new.phone_call_at := null'].every((x) => body.includes(x))
  && /drop trigger if exists evv_submissions_public_insert_guard_422/.test(body) === false)
ck('SQL: the client page can only set the client signature (the update names sig_consumer + status columns only)',
  /update public\.evv_submissions set sig_consumer = v_sc, client_sig_status = 'signed', client_signed_at = now\(\), client_sign_via = 'sign_link'\s*\n\s*where id = f\.id/.test(body))
ck('SQL: who recorded the phone call comes from the sign-in, never from the request', /v_by := left\(coalesce\(nullif\(claims->>'email', ''\)/.test(body) && !/p_payload->>'by'/.test(body))
ck('SQL: staff cannot write signatures or the phone record directly, and cannot accept an unsigned form', /EVV429: a signature or the phone verification can only be recorded through its own step/.test(body)
  && /EVV429: the client has not signed this form/.test(body) && /coalesce\(new\.outcome, ''\) <> 'dismissed'/.test(body))
ck('SQL: nothing is deleted, truncated or dropped (except replacing its own trigger); no existing row is updated by the install',
  !/\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i.test(body.replace(/'[A-Z]+'/g, '')) && (body.match(/drop trigger if exists/g) || []).length === 1
  && !/^\s*update\s+public\.evv_submissions/im.test(body.split('create or replace function')[0]))
ck('no em dashes, and never her banned phrase, in anything 429 added (SQL, proof, helper, client page)', ![sq, pf, helperSrc, signPage].some((t) => DASH.test(t) || PLAINLANG.test(t)))
{ const added = tkSrc.slice(tkSrc.indexOf('PASS 4 (429)'), tkSrc.indexOf('const summary = {'))
  const outMsg = (tkSrc.match(/const msgOutTmpl[\s\S]*?`;?\n/) || [''])[0]
  ck('timekeeper: no em dashes in the 429 part or the new clock-out wording', added.length > 1000 && !DASH.test(added) && !DASH.test(outMsg) && !PLAINLANG.test(added), [DASH.test(added), DASH.test(outMsg)]) }
{ const a = form.indexOf('/* 429: "<client> will sign'), b = form.indexOf('return { token, fields, statusWords')
  const parts = [form.slice(a, b), (form.match(/<!-- 429: only while[\s\S]*?<\/div>\n    <\/div>/) || [''])[0], (form.match(/\/\* 429: the "will sign at my next visit" choice[\s\S]*?addEventListener\('input', laterSync\);/) || [''])[0]]
  ck('form: no em dashes in the 429 parts', parts.every((p) => p.length > 50 && !DASH.test(p) && !PLAINLANG.test(p)), parts.map((p) => p.length)) }

// ── 2 · the helper ──
const H = await import(path.join(process.cwd(), FN, '_shared/evv-sign.ts'))
ck('helper: the link is the page + the token, nothing else', H.signUrl('11111111-2222-4333-8444-555555555555') === 'https://sc.mo-care.com/evv-client-sign.html?t=11111111-2222-4333-8444-555555555555')
ck('helper: dates in words', H.dateWords('2026-09-30') === 'Wednesday, Sep 30' && H.dateWords('x') === 'x')
ck('helper: the message (default; a custom wording without {link} still gets the link)',
  H.nextVisitMessage(null, { first: 'Maria', client: 'Ruth', date: 'Wednesday, Sep 30', link: 'L' }) === "Hi Maria, it's Caring Companions. While you're with Ruth today, please have Ruth sign the EVV correction form from Wednesday, Sep 30: L"
  && H.nextVisitMessage('Hi {first_name}, get {client} to sign', { first: 'M', client: 'R', date: 'd', link: 'L' }) === 'Hi M, get R to sign L')
{ const sg = { caregiver_axiscare_id: '501', client_axiscare_id: '701', visit_id: '9001', visit_date: '2026-09-30' }
  const V = (id, cg, cl, day, s, e, cin, cout) => ({ id, caregiver: { id: cg }, client: { id: cl, firstName: 'Ruth' }, scheduledStartDate: `${day}T${s}:00`, scheduledEndDate: `${day}T${e}:00`,
    clockIn: cin ? { time: `${day}T${cin}:00` } : null, clockOut: cout ? { time: `${day}T${cout}:00` } : null })
  const NOWS = (hm, day = '2026-10-02') => (st) => (Date.parse(`${day}T${hm}:00`) - Date.parse(st)) / 60000
  const base = [V(9002, 501, 701, '2026-10-02', '09:00', '13:00', '09:02', null)]
  ck('decide: clocked in 13 minutes at the next visit = send', H.decideNextVisit(sg, base, NOWS('09:15'), false).action === 'send')
  ck('decide: clocked in only 3 minutes = wait (it goes 10 minutes in)', H.decideNextVisit(sg, base, NOWS('09:05'), false).action === 'wait')
  ck('decide: not clocked in yet = wait; the visit ended with no clock-in = nothing today',
    H.decideNextVisit(sg, [V(9002, 501, 701, '2026-10-02', '09:00', '13:00', null, null)], NOWS('09:20'), false).action === 'wait'
    && H.decideNextVisit(sg, [V(9002, 501, 701, '2026-10-02', '09:00', '13:00', null, null)], NOWS('13:20'), false).action === 'none')
  ck('decide: at night = wait (it goes at 7am if she is still there)', H.decideNextVisit(sg, base, NOWS('09:15'), true).action === 'wait' && /night/.test(H.decideNextVisit(sg, base, NOWS('09:15'), true).why))
  ck('decide: already clocked out, or long past the end = nothing', H.decideNextVisit(sg, [V(9002, 501, 701, '2026-10-02', '09:00', '13:00', '09:02', '13:00')], NOWS('13:05'), false).action === 'none'
    && H.decideNextVisit(sg, base, NOWS('13:45'), false).action === 'none' && H.decideNextVisit(sg, base, NOWS('13:20'), false).action === 'send')
  ck('decide: never the corrected visit itself, another caregiver, or another client', H.decideNextVisit(sg, [V(9001, 501, 701, '2026-09-30', '09:00', '13:00', '09:02', null)], NOWS('09:20', '2026-09-30'), false).action === 'none'
    && H.decideNextVisit(sg, [V(9002, 502, 701, '2026-10-02', '09:00', '13:00', '09:02', null)], NOWS('09:20'), false).action === 'none'
    && H.decideNextVisit(sg, [V(9002, 501, 702, '2026-10-02', '09:00', '13:00', '09:02', null)], NOWS('09:20'), false).action === 'none')
  ck('decide: a later visit the SAME day counts (it is not the corrected one)', H.decideNextVisit(sg, [V(9003, 501, 701, '2026-09-30', '17:00', '19:00', '17:01', null)], NOWS('17:15', '2026-09-30'), false).action === 'send')
  ck('decide: an office-linked form with no visit number: only a later DAY counts', H.decideNextVisit({ ...sg, visit_id: null }, [V(9003, 501, 701, '2026-09-30', '17:00', '19:00', '17:01', null)], NOWS('17:15', '2026-09-30'), false).action === 'none'
    && H.decideNextVisit({ ...sg, visit_id: null }, base, NOWS('09:15'), false).action === 'send')
  ck('look ahead: finds the next visit with her; none = null', H.upcomingVisit(sg, [V(9005, 501, 701, '2026-10-06', '09:00', '13:00')], '2026-10-02')?.id === 9005
    && H.upcomingVisit(sg, [V(9005, 502, 701, '2026-10-06', '09:00', '13:00'), V(9001, 501, 701, '2026-09-30', '09:00', '13:00')], '2026-10-02') === null)
  const it = H.signItem('no_visit', { client_display: 'Ruth A.', caregiver_name: 'Maria Lopez' }, { id: 'S1', visitdate: '2026-09-30', new_in: '09:00', new_out: '13:00' }, { owner: 'sam@mo-care.com', now: '2026-10-02T14:00:00Z' })
  ck('item: "No upcoming visit with Ruth: call Ruth to verify", one per form, a person calls', it.id === 'ops_evvsig_S1' && it.title === "No upcoming visit with Ruth: call Ruth to verify Maria Lopez's EVV correction (Wednesday, Sep 30)"
    && /9:00 AM to 1:00 PM/.test(it.detail) && /Verified by phone/.test(it.detail) && /nothing contacts the client automatically/.test(it.detail) && it.status === 'open' && !DASH.test(it.title + it.detail), it) }

// ── 3 · the REAL timekeeper against fakes ──
let NOW = Date.parse('2026-10-02T14:00:00Z')
const RealDate = Date
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const at = (hm, day = '2026-10-02') => { NOW = RealDate.parse(`${day}T${hm}:00-05:00`) }
let APP, T, SENT, VISITS, AHEAD, GHLDOWN, AXQ
const SIGTOK = '11111111-2222-4333-8444-555555555555'
const reset = (o = {}) => {
  APP = { ops_settings: { timekeeper_watch_live: true, timekeeper_text_live: true, timekeeper_admin_loop_live: false, coverage_alert_admins: ['sam@mo-care.com'], ...(o.settings || {}) },
    caregivers: [{ id: 1, first: 'Maria', last: 'Lopez', phone: '4175550111', axiscare_id: '501', active: true }],
    coordinator_staff: [{ email: 'sam@mo-care.com', name: 'Samantha T', phone: '4175550901' }],
    timekeeper_cases: [], coverage_cases: [], ops_items: [], automation_log: [], evv_chase_state: [], evv_followups: [] }
  T = { phone_index: [], contact_optout_current: [], circle_contacts: [], op_events: [], contact_send_refusals: [], evv_prefill: [],
    evv_submissions: [{ id: 'S1', attendant: 'Maria Lopez', consumer: 'Ruth A.', visitdate: '2026-09-30', new_in: '09:00', new_out: '13:00', processed: false,
      client_sig_status: 'waiting', caregiver_axiscare_id: '501', client_axiscare_id: '701', caregiver_linked_name: 'Maria Lopez', client_linked_name: 'Ruth Adams', axiscare_visit_id: '9001' }],
    evv_sign: [{ token: SIGTOK, submission_id: 'S1', expires_at: '2026-10-14T14:00:00Z', caregiver_axiscare_id: '501', client_axiscare_id: '701',
      caregiver_name: 'Maria Lopez', client_display: 'Ruth A.', visit_date: '2026-09-30', visit_id: '9001', used_at: null, closed_at: null, next_visit_tries: 0 }] }
  SENT = []; GHLDOWN = false; AXQ = []
  VISITS = [{ id: 9002, caregiver: { id: 501, firstName: 'Maria', lastName: 'Lopez' }, client: { id: 701, firstName: 'Ruth', lastName: 'Adams', homePhone: '4175550777' },
    scheduledStartDate: '2026-10-02T09:00:00', scheduledEndDate: '2026-10-02T13:00:00', clockIn: { time: '2026-10-02T09:02:00' }, clockOut: null }]
  AHEAD = null   // null = same as VISITS
}
const q = (t) => { const st = { f: [], upd: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, contains() { return b }, in() { return b }, is() { return b }, gte() { return b }, lte() { return b }, ilike() { return b }, not() { return b }, or() { return b }, neq() { return b },
  eq(c, v) { st.f.push([c, v]); return b },
  insert(row) { (T[t] ||= []).push(JSON.parse(JSON.stringify(row))); return Promise.resolve({ data: row, error: null }) },
  update(p) { st.upd = p; return b },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })) },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]
      return Promise.resolve({ data: k in APP ? [{ key: k, data: JSON.parse(JSON.stringify(APP[k])) }] : [], error: null }).then(ok) }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    if (st.upd) { rows.forEach((r) => Object.assign(r, JSON.parse(JSON.stringify(st.upd)))); return Promise.resolve({ data: null, error: null }).then(ok) }
    return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null }).then(ok)
  } }; return b }
globalThis.__db = { from: q, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) },
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); const it = JSON.parse(JSON.stringify(a.item)); if (i >= 0) arr[i] = it; else arr.push(it) } return { data: null, error: null } } }
const PHONE_OF = {}
globalThis.fetch = async (url, o) => { url = String(url); const bd = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('axiscare.com/api/visits?clientIds=')) { AXQ.push(url); return new Response(JSON.stringify({ results: { visits: JSON.parse(JSON.stringify(AHEAD ?? VISITS)), nextPage: null } }), { status: 200 }) }
  if (url.includes('axiscare.com/api/visits?')) return new Response(JSON.stringify({ results: { visits: JSON.parse(JSON.stringify(VISITS)), nextPage: null } }), { status: 200 })
  if (url.includes('/contacts/upsert')) { const id = 'C:' + (bd.phone || bd.email); PHONE_OF[id] = bd.phone || bd.email; return new Response(JSON.stringify({ contact: { id, dnd: false } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { if (GHLDOWN) return new Response('{"message":"down"}', { status: 500 }); SENT.push({ to: PHONE_OF[bd.contactId] || bd.contactId, message: bd.message || '' }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
const JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc_' + 'k'.repeat(60), GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', AXISCARE_API_KEY: 'ax' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
globalThis.__dbFor = () => ({ from: () => { const bb = { select() { return bb }, limit() { return Promise.resolve({ data: [], error: null }) } }; return bb } })
fs.writeFileSync(`${FN}/_shared/_job-auth_429t.ts`, fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)'))
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_429t.ts`) } catch { /* */ } })
const tmp = path.join(process.cwd(), FN, 'timekeeper-watch', '_t429.ts')
fs.writeFileSync(tmp, tkSrc.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_429t.ts'"))
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const TK = handler
const tick = async (qs = '') => { const r = await TK(new Request('https://x/functions/v1/timekeeper-watch' + qs, { method: 'POST', headers: { Authorization: 'Bearer eyJanon', 'x-cron-secret': JOBSEC } })); return r.json() }
const to_ = (p) => SENT.filter((m) => String(m.to).replace(/\D/g, '').endsWith(p))
const toCg = () => to_('4175550111'), toClient = () => to_('4175550777')
const sign = () => T.evv_sign[0]
const items = () => APP.ops_items.filter((x) => String(x.id).startsWith('ops_evvsig_'))
const LINK = `https://sc.mo-care.com/evv-client-sign.html?t=${SIGTOK}`
const WANT = `Hi Maria, it's Caring Companions. While you're with Ruth today, please have Ruth sign the EVV correction form from Wednesday, Sep 30: ${LINK}`

/* a · AT THE SHIFT: the clock-out reminder asks for the form before they leave */
reset(); VISITS = [{ ...VISITS[0], id: 9001, scheduledStartDate: '2026-10-02T09:00:00', scheduledEndDate: '2026-10-02T13:00:00', clockIn: { time: '2026-10-02T09:04:00' } }]; T.evv_sign = []; T.evv_submissions = []
at('13:10'); await tick()
{ const m = toCg()[0]?.message || ''; const u = (m.match(/https:\/\/sc\.mo-care\.com\/evv-correction-form\.html\?t=([0-9a-f-]{36})/) || [])[0]
  ck('clock-out reminder · the exact new wording: before you leave, have Ruth sign it (pre-filled link, token only)', toCg().length === 1 && !!u
    && m === `Hi Maria, it's Caring Companions. Your shift with Ruth ended at 1pm but there's no clock-out yet. Please clock out in the AxisCare app now. If you need your time corrected, fill in this form before you leave and have Ruth sign it: ${u}. If you didn't put in your shift note, text it to the office now so we can put it in your shift for you.`, m)
  ck('clock-out reminder · "Caring Companions", never "it\'s Cara"; no em dash', !/it's Cara/.test(m) && !DASH.test(m)) }
reset({ settings: { timekeeper_msg_out: 'Hi {first_name}, clock out please. Form: sc.mo-care.com/evv-correction-form' } }); VISITS = [{ ...VISITS[0], id: 9001, clockIn: { time: '2026-10-02T09:04:00' } }]; T.evv_sign = []; T.evv_submissions = []
at('13:10'); await tick()
ck('clock-out reminder · her own wording (timekeeper_msg_out) is used as it is (only the link is swapped)', /^Hi Maria, clock out please\. Form: https:\/\/sc\.mo-care\.com\/evv-correction-form\.html\?t=/.test(toCg()[0]?.message || ''), toCg())

/* b · NEXT VISIT, switch OFF (the default): practice only */
reset(); at('09:15'); let j = await tick()
ck('next visit, switch off · nothing is texted to anyone; recorded once as practice', SENT.length === 0 && !!sign().next_visit_practice_at && sign().next_visit_id === '9002' && !sign().next_visit_texted_at
  && j.evv_next_visit?.live === false && j.evv_next_visit?.would_text === 1, { SENT, s: sign(), j: j.evv_next_visit })
const firstPractice = sign().next_visit_practice_at; at('09:30'); await tick()
ck('next visit, switch off · the practice stamp is not rewritten each run', sign().next_visit_practice_at === firstPractice && SENT.length === 0)
reset({ settings: { evv_next_visit_live: true, timekeeper_text_live: false } }); at('09:15'); await tick()
ck('next visit · the caregiver-text switch (timekeeper_text_live) off also stops it', SENT.length === 0 && !sign().next_visit_texted_at)

/* c · NEXT VISIT, switch ON */
reset({ settings: { evv_next_visit_live: true } }); at('09:05'); await tick()
ck('next visit · clocked in 3 minutes: not yet', SENT.length === 0 && !sign().next_visit_texted_at)
at('09:15'); j = await tick()
ck('next visit · 10+ minutes in: ONE text to the caregiver, the exact words, the client-signature link', toCg().length === 1 && toCg()[0].message === WANT && j.evv_next_visit?.texted === 1, { SENT, j: j.evv_next_visit })
ck('next visit · NOTHING to the client or anyone else', toClient().length === 0 && SENT.length === 1)
ck('next visit · the link carries only the token', new URL(LINK).searchParams.size === 1 && UUIDRE.test(new URL(LINK).searchParams.get('t')) && !/maria|ruth|4175|2026/i.test(LINK))
ck('next visit · marked sent once (visit, time), the link kept good through the visit', sign().next_visit_texted_at && sign().next_visit_id === '9002' && Date.parse(sign().expires_at) >= NOW + 864e5 - 1000, sign())
at('09:40'); await tick(); at('12:00'); await tick()
ck('next visit · never a second text for the same form', toCg().length === 1)
reset({ settings: { evv_next_visit_live: true } }); VISITS[0].id = 9001; VISITS[0].scheduledStartDate = '2026-09-30T09:00:00'; at('09:15', '2026-09-30'); await tick()
ck('next visit · the corrected visit itself never triggers it', SENT.filter((m) => /evv-client-sign/.test(m.message)).length === 0)
reset({ settings: { evv_next_visit_live: true } }); VISITS[0].clockIn = null; at('09:30'); await tick()
ck('next visit · no clock-in yet: no text (the missed clock-in flow owns that)', SENT.filter((m) => /evv-client-sign/.test(m.message)).length === 0 && !sign().next_visit_texted_at)
reset({ settings: { evv_next_visit_live: true } }); VISITS[0] = { ...VISITS[0], scheduledStartDate: '2026-10-02T20:00:00', scheduledEndDate: '2026-10-03T08:00:00', clockIn: { time: '2026-10-02T20:01:00' } }
at('20:30'); await tick()
ck('next visit · overnight visit at 8:30pm: no text (night)', SENT.length === 0)
VISITS[0].scheduledStartDate = '2026-10-02T20:00:00'; at('07:05', '2026-10-03'); AHEAD = []; await tick()
ck('next visit · still there at 7:05am: the text goes then', toCg().length === 1 && /evv-client-sign/.test(toCg()[0].message), SENT)

/* d · not reached: opted out, no phone, GoHighLevel down */
reset({ settings: { evv_next_visit_live: true } }); T.contact_optout_current = [{ address: '+14175550111', channel: 'sms', opted_out: true, source: 'STOP' }]; at('09:15'); await tick()
ck('opted out · no text; marked final; a Needs Attention item: call Ruth to verify', SENT.length === 0 && sign().next_visit_refused_at && items().length === 1 && /could not be texted the signature link for Ruth: call Ruth to verify/.test(items()[0].title), { items: items(), s: sign() })
ck('opted out · the refusal also shows as a "didn\'t go through" card (no silent failure)', APP.ops_items.some((x) => x.kind === 'send_problem'), APP.ops_items.map((x) => x.kind))
at('09:30'); await tick(); ck('opted out · never retried', SENT.length === 0 && items().length === 1)
reset({ settings: { evv_next_visit_live: true } }); APP.caregivers[0].phone = ''; at('09:15'); await tick()
ck('no phone on the roster · no text, an item to call Ruth', SENT.length === 0 && items().length === 1 && /no phone on the roster/.test(items()[0].detail), items())
reset({ settings: { evv_next_visit_live: true } }); GHLDOWN = true
for (const hm of ['09:15', '09:17', '09:19']) { at(hm); await tick() }
ck('GoHighLevel refuses · not stamped as sent, tried 3 times, a "didn\'t go through" card, then an item to call', !sign().next_visit_texted_at && sign().next_visit_tries === 3 && !!sign().next_visit_refused_at
  && items().length === 1 && APP.ops_items.some((x) => x.kind === 'send_problem'), { s: sign(), it: APP.ops_items.map((x) => x.id) })
GHLDOWN = false; at('09:21'); await tick(); ck('GoHighLevel refuses · after 3 tries it stops', SENT.length === 0)

/* e · WORST CASE: no next visit within 14 days */
reset({ settings: { evv_next_visit_live: true } }); VISITS = []; AHEAD = [{ id: 9010, caregiver: { id: 502 }, client: { id: 701 }, scheduledStartDate: '2026-10-05T09:00:00', scheduledEndDate: '2026-10-05T13:00:00' }]
at('08:30'); await tick()
ck('look ahead · not before 9am', AXQ.length === 0 && items().length === 0)
at('09:10'); await tick()
ck('look ahead · AxisCare asked once, for this client, today to the link end', AXQ.length === 1 && /clientIds=701&startDate=2026-10-02&endDate=2026-10-14/.test(AXQ[0]), AXQ)
ck('look ahead · no visit with Maria and Ruth in 14 days: the item "No upcoming visit with Ruth: call Ruth to verify"', items().length === 1
  && items()[0].title === "No upcoming visit with Ruth: call Ruth to verify Maria Lopez's EVV correction (Wednesday, Sep 30)" && SENT.length === 0, items())
at('09:12'); await tick(); at('15:00'); await tick()
ck('look ahead · once a day, one item (not repeated)', AXQ.length === 1 && items().length === 1)
reset({ settings: { evv_next_visit_live: true } }); VISITS = []; AHEAD = [{ id: 9011, caregiver: { id: 501 }, client: { id: 701 }, scheduledStartDate: '2026-10-07T09:00:00', scheduledEndDate: '2026-10-07T13:00:00' }]
at('09:10'); await tick()
ck('look ahead · a visit next week: no item; noted on the row', items().length === 0 && sign().next_check_day === '2026-10-02' && sign().next_visit_seen === '2026-10-07T09:00', sign())
reset(); T.evv_sign[0].expires_at = '2026-10-01T00:00:00Z'; at('10:00'); await tick()
ck('expired link, still unsigned · an item to call Ruth (practice mode too: it is an office item, not a text)', items().length === 1 && /still not signed by Ruth: call Ruth to verify/.test(items()[0].title) && SENT.length === 0, items())

/* f · housekeeping */
reset(); T.evv_submissions[0].client_sig_status = 'signed'; at('09:15'); await tick()
ck('a form signed meanwhile (or verified by phone) · its link row is closed, nothing sent', !!sign().closed_at && SENT.length === 0, sign())
reset(); T.evv_sign = []; T.evv_submissions[0].axiscare_visit_id = null; at('09:15'); await tick()
ck('a plain form the office linked to Maria and Ruth · gets its link row (no visit number: a later day counts)', T.evv_sign.length === 1 && T.evv_sign[0].submission_id === 'S1' && UUIDRE.test(T.evv_sign[0].token)
  && T.evv_sign[0].caregiver_axiscare_id === '501' && T.evv_sign[0].visit_id === null && !!T.evv_sign[0].next_visit_practice_at, T.evv_sign)
reset(); T.evv_sign = []; T.evv_submissions[0].client_axiscare_id = null; at('09:15'); await tick()
ck('a plain form NOT linked yet · no link row (the office sees "no visit link" and can verify by phone)', T.evv_sign.length === 0)
reset({ settings: { evv_next_visit_live: true, timekeeper_watch_live: false } }); at('09:15'); j = await tick()
ck('dry run (watch off) · writes nothing, sends nothing', SENT.length === 0 && !sign().next_visit_practice_at && !sign().next_visit_texted_at && items().length === 0 && j.mode === 'DRY RUN')

/* g · the morning chase is retired */
reset({ settings: { evv_chase_live: true } }); T.evv_sign = []; T.evv_submissions = []
VISITS = [{ id: 9100, caregiver: { id: 501, firstName: 'Maria', lastName: 'Lopez' }, client: { id: 701, firstName: 'Ruth' }, scheduledStartDate: '2026-10-01T09:00:00', scheduledEndDate: '2026-10-01T13:00:00', clockIn: null, clockOut: null }]
at('09:30'); j = await tick()
ck('morning chase retired · evv_chase_live on, yesterday\'s missed punch: NO text asking for a new form', SENT.length === 0 && /retired in 429/.test(j.evv_chase?.why || ''), { SENT, c: j.evv_chase })
ck('source · the old chase wording and its per-visit followups stamp are gone; the Saturday office reminder stays',
  !/EVV correction form and have the client sign it/.test(tkSrc) && !/by: 'evv-chase'/.test(tkSrc) && /satnudge_/.test(tkSrc))
ck('source · the next-visit text goes to the CAREGIVER only (audience caregiver, sms, opt-out checked); no client phone is read',
  /contactForOutbound\(sb, ghl, \{ phone, firstName: first \}, 'urgent_internal',\s*\{ audience: 'caregiver', channel: 'sms', sender: 'timekeeper-watch \(EVV next visit\)' \}\)/.test(tkSrc)
  && !/homePhone|client\.phone|client_phone/.test(tkSrc.slice(tkSrc.indexOf('PASS 4 (429)'), tkSrc.indexOf('const summary = {'))))
ck('source · switches: needs evv_next_visit_live === true AND the caregiver texts; the summary reports both', /const nvLive = textLive && settings\.evv_next_visit_live === true/.test(tkSrc)
  && /evv_next_visit_live: settings\.evv_next_visit_live === true, evv_chase_live: settings\.evv_chase_live === true/.test(tkSrc))
globalThis.Date = RealDate

// ── 4 · the public pages in a fake browser ──
function fakeBrowser(search, rpcImpl, insertImpl) {
  const els = {}, handlers = {}
  const cls = () => { const s = new Set(); return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); return v } } }
  const mk = (id) => { const ev = {}; const e = { id, value: '', checked: false, disabled: false, readOnly: false, textContent: '', innerHTML: '', style: {}, className: '', height: 140, width: 0,
    classList: cls(), addEventListener: (k, f) => { (ev[k] ||= []).push(f) }, fire: (k, x) => (ev[k] || []).forEach((f) => f(x || { preventDefault() {}, cancelable: true, clientX: 5, clientY: 5 })),
    focus() {}, scrollIntoView() {}, closest: () => mk('x'), getBoundingClientRect: () => ({ width: 300, left: 0, top: 0 }),
    getContext: () => ({ setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {} }), toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=' }; return e }
  const get = (id) => (els[id] ||= mk(id))
  const CALLS = []
  let radio = null
  const sb = { rpc: async (fn, a) => { CALLS.push({ fn, a: JSON.parse(JSON.stringify(a)) }); return { data: rpcImpl(fn, a), error: null } },
    from: (t) => ({ insert: async (rows) => { CALLS.push({ fn: 'insert:' + t, a: JSON.parse(JSON.stringify(rows)) }); return insertImpl ? insertImpl(rows) : { error: null } } }) }
  const win = { addEventListener: (k, f) => { (handlers[k] ||= []).push(f) }, devicePixelRatio: 1, scrollTo() {} }
  const ctx = { document: { getElementById: get, querySelectorAll: (s) => (/tasks/.test(s) ? [] : []), querySelector: (s) => (/reason\]:checked/.test(s) ? radio : null) },
    window: win, location: { search }, supabase: { createClient: () => sb }, URLSearchParams, console, setTimeout: (f) => 0, clearTimeout() {}, Date, JSON, Object, String, Promise, globalThis: {} }
  Object.assign(win, { supabase: ctx.supabase, document: ctx.document })
  vm.createContext(ctx)
  return { ctx, get, CALLS, setRadio: (v) => { radio = { value: v, closest: () => mk('r') } }, load: async () => { for (const f of handlers.load || []) await f(); await new Promise((r) => setImmediate(r)) },
    run: (code) => vm.runInContext(code, ctx) }
}
const scriptOf = (html) => html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'))
const draw = (B, id) => { const c = B.get(id); c.fire('mousedown'); c.fire('mousemove'); c.fire('mouseup') }
const fill = (B) => { B.get('f-new-in').value = '09:00'; B.get('f-new-out').value = '13:00'; B.get('f-notes').value = 'Phone died'; B.setRadio('Forgot to clock in or out'); draw(B, 'sig-attendant') }
const PREINFO = { status: 'ok', caregiver_name: 'Maria Lopez', client_display: 'Ruth A.', visit_date: '2026-09-30', scheduled_in: '09:00', scheduled_out: '13:00', actual_in: '09:04', actual_out: null, which_missing: 'out' }
const PRETOK = '22222222-2222-4333-8444-555555555555'
{ // plain form
  let B = fakeBrowser('', () => null); B.run(scriptOf(form)); await B.load()
  B.get('f-attendant').value = 'Maria Lopez'; B.get('f-consumer').value = 'Ruth Adams'; B.get('f-consumer').fire('input'); B.get('f-visitdate').value = '2026-09-30'; fill(B)
  ck('plain form · the choice shows while the client box is empty, with the client\'s name', B.get('later-box').classList.contains('show') && B.get('later-label').textContent === 'Ruth will sign at my next visit'
    && /Only if Ruth cannot sign right now/.test(B.get('later-note').textContent), [B.get('later-label').textContent, B.get('later-box').classList.contains('show')])
  await B.run('submitForm()')
  ck('plain form · no client signature and no choice: refused in the page ("Client signature required"), nothing sent', B.get('err-sig2').classList.contains('show') && B.CALLS.length === 0)
  B.get('f-later').checked = true; B.run('laterChanged()'); await B.run('submitForm()')
  const ins = B.CALLS.find((c) => c.fn === 'insert:evv_submissions')
  ck('plain form · with "Ruth will sign at my next visit": sent as before (plain insert), without a client signature', ins && ins.a[0].sig_consumer === null && ins.a[0].sig_attendant && !('client_signs_later' in ins.a[0]) && ins.a[0].attendant === 'Maria Lopez', B.CALLS)
  ck('plain form · the thank-you says Ruth still needs to sign, and the office will match it or call', B.get('success-title').textContent === 'Your part is sent'
    && /Ruth still needs to sign\. The office will match this form to your visit/.test(B.get('success-main').textContent), B.get('success-main').textContent)
  B = fakeBrowser('', () => null); B.run(scriptOf(form)); await B.load()
  B.get('f-attendant').value = 'Maria Lopez'; B.get('f-consumer').value = 'Ruth Adams'; B.get('f-visitdate').value = '2026-09-30'; fill(B)
  B.get('f-later').checked = true; B.run('laterChanged()'); draw(B, 'sig-consumer')
  ck('plain form · once the client signs, the choice is hidden and unticked', !B.get('later-box').classList.contains('show') && B.get('f-later').checked === false)
  await B.run('submitForm()')
  const ins2 = B.CALLS.find((c) => c.fn === 'insert:evv_submissions')
  ck('plain form · signed by the client at the shift: sent with both signatures, the usual thank-you', ins2 && /^data:image\/png/.test(ins2.a[0].sig_consumer) && B.get('success-title').textContent === '', B.CALLS)
  B.run("clearSig('sig-consumer')"); ck('plain form · clearing the client box offers the choice again', B.get('later-box').classList.contains('show'))
}
{ // pre-filled form
  let B = fakeBrowser('?t=' + PRETOK, (fn) => (fn === 'evv_prefill_get' ? PREINFO : fn === 'evv_submit_prefilled' ? { ok: true, id: 'x', waiting: true } : null)); B.run(scriptOf(form)); await B.load()
  ck('pre-filled form · the choice names the client from the visit', B.get('later-label').textContent === 'Ruth will sign at my next visit' && B.get('f-consumer').value === 'Ruth A.', B.get('later-label').textContent)
  fill(B); B.get('f-later').checked = true; B.run('laterChanged()'); await B.run('submitForm()')
  const c = B.CALLS.find((x) => x.fn === 'evv_submit_prefilled')
  ck('pre-filled form · "Ruth will sign at my next visit": saved through the link with client_signs_later and no client signature', c && c.a.p_token === PRETOK && c.a.p_payload.client_signs_later === true && c.a.p_payload.sig_consumer === null, B.CALLS)
  ck('pre-filled form · the thank-you: a text at the next visit with Ruth, or the office calls', /At your next visit with Ruth you will get a text with a link: open it and have Ruth sign on your phone\. If Ruth cannot sign, the office will call to verify\./.test(B.get('success-main').textContent), B.get('success-main').textContent)
  B = fakeBrowser('?t=' + PRETOK, (fn) => (fn === 'evv_prefill_get' ? PREINFO : { ok: true, id: 'x', waiting: false })); B.run(scriptOf(form)); await B.load()
  fill(B); draw(B, 'sig-consumer'); await B.run('submitForm()')
  const c2 = B.CALLS.find((x) => x.fn === 'evv_submit_prefilled')
  ck('pre-filled form · signed at the shift: no client_signs_later, both signatures', c2 && !('client_signs_later' in c2.a.p_payload) && /^data:image\/png/.test(c2.a.p_payload.sig_consumer), c2)
}
{ // the client-signature page
  const STOK = '33333333-2222-4333-8444-555555555555'
  const INFO = { status: 'ok', caregiver_name: 'Maria Lopez', client_display: 'Ruth A.', visit_date: '2026-09-30', submitted_on: '2026-09-30', orig_in: '09:04', orig_out: null, new_in: '09:00', new_out: '13:00',
    reason: 'Forgot to clock in or out', tasks: 'Bathing, shampooing hair; Dietary, meals', notes: 'Phone <b>died</b>', sig_attendant: 'data:image/png;base64,iVBORw0KGgo=' }
  let B = fakeBrowser('?t=' + STOK, (fn) => (fn === 'evv_sign_get' ? INFO : { ok: true })); B.run(scriptOf(signPage)); await B.load()
  const html = B.get('page').innerHTML
  ck('client page · shows the caregiver\'s completed part, read only (no boxes to change it)', html.includes('Maria Lopez') && html.includes('9:00 AM to 1:00 PM') && html.includes('Wednesday, September 30, 2026')
    && html.includes('Forgot to clock in or out') && html.includes('Phone &lt;b&gt;died&lt;/b&gt;') && html.includes('Caregiver signature') && !/<input type="(time|date|text)"|<textarea/.test(html), html.slice(0, 500))
  ck('client page · keeps the form\'s own client-signature wording + "I confirm Maria Lopez cared for me ..."', html.includes('The client\'s signature confirms they were receiving care during the corrected timeframe.')
    && html.includes('I confirm Maria Lopez cared for me on Wednesday, September 30, 2026 from 9:00 AM to 1:00 PM.'))
  await B.run('submitSig()')
  ck('client page · without the tick and a signature: refused in the page, nothing saved', B.get('err-confirm').classList.contains('show') && B.get('err-sig').classList.contains('show') && !B.CALLS.some((c) => c.fn === 'evv_sign_submit'))
  B.get('f-confirm').checked = true; draw(B, 'sig-consumer'); await B.run('submitSig()')
  const c = B.CALLS.find((x) => x.fn === 'evv_sign_submit')
  ck('client page · saves ONLY the token, the tick and the client signature', c && c.a.p_token === STOK && JSON.stringify(Object.keys(c.a.p_payload).sort()) === '["confirm","sig_consumer"]' && /^data:image\/png/.test(c.a.p_payload.sig_consumer), c)
  ck('client page · thank-you', /The form is signed/.test(B.get('page').innerHTML))
  for (const [st, want] of [['signed', 'Already signed'], ['closed', 'Nothing to sign'], ['expired', 'call the office'], ['not_found', 'not valid']]) {
    B = fakeBrowser('?t=' + STOK, () => ({ status: st })); B.run(scriptOf(signPage)); await B.load()
    ck(`client page · a ${st} link says so ("${want}") and shows nothing of the form`, B.get('page').innerHTML.includes(want) && !B.get('page').innerHTML.includes('Maria'))
  }
  B = fakeBrowser('?t=Maria', () => INFO); B.run(scriptOf(signPage)); await B.load()
  ck('client page · a bad address never asks the database', B.CALLS.length === 0 && B.get('page').innerHTML.includes('not valid'))
  const E = B.ctx.globalThis.EVVSIGN || B.run('EVVSIGN')
  ck('client page · answers: confirm/signature named; signed/closed/expired final', E.submitWords({ ok: false, error: 'invalid', field: 'confirm' })[0] === 'Please tick the box to confirm the times.'
    && E.submitWords({ ok: false, error: 'signed' })[1] === true && E.submitWords({ ok: false, error: 'expired' })[1] === true && E.submitWords({ ok: true }) === null)
}

// ── 5 · the SQL and its proofs in a real Postgres ──
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const s422 = fs.readFileSync('evv_forms_422.sql', 'utf8'), s427 = fs.readFileSync('evv_prefill_427.sql', 'utf8')
  const p422 = fs.readFileSync('evv_forms_422_proof.sql', 'utf8'), p427 = fs.readFileSync('evv_prefill_427_proof.sql', 'utf8')
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
insert into public.evv_submissions (id, attendant, consumer, visitdate, new_in, new_out, processed, sig_consumer) values
  ('00000000-0000-4000-8000-000000000001', 'Old One', 'Client A', '2026-09-01', '08:00', '12:00', true, 'data:image/png;base64,iVBORw0KGgo='),
  ('00000000-0000-4000-8000-000000000002', 'Old Unsigned', 'Client B', '2026-09-02', '08:00', '12:00', false, null);`)
    let err = null
    try { await db.exec(s422); await db.exec(s427) } catch (e) { err = e.message }
    const before = (await db.query(`select md5(string_agg(to_jsonb(e)::text, '' order by id)) as m from public.evv_submissions e`)).rows[0].m
    try { await db.exec(sq); await db.exec(sq) } catch (e) { err = e.message }
    ck(`PGLITE (${kind}): 429 runs after 422 + 427, and runs again (idempotent)`, !err, err)
    const after = (await db.query(`select md5(string_agg((to_jsonb(e) - 'client_sig_status' - 'client_signed_at' - 'client_sign_via' - 'phone_verified_by' - 'phone_verified_at' - 'phone_call_at' - 'phone_verified_with' - 'phone_verified_relationship' - 'phone_verified_confirmed' - 'phone_verified_notes')::text, '' order by id)) as m from public.evv_submissions e`)).rows[0].m
    const newCols = (await db.query(`select count(*)::int as n from public.evv_submissions where client_sig_status is not null or phone_verified_by is not null`)).rows[0].n
    ck(`PGLITE (${kind}): no existing form was changed by the install (new columns empty)`, before === after && newCols === 0, [before, after, newCols])
    const proof = async (txt) => { try { await db.exec(txt); return null } catch (e) { return e.message.includes('PROBE_RESULT: ') ? JSON.parse(e.message.split('PROBE_RESULT: ')[1]) : { thrown: e.message } } }
    const snap = async () => (await db.query(`select (select count(*) from public.evv_submissions)::int as n, (select count(*) from public.evv_sign)::int as s, (select count(*) from public.evv_prefill)::int as p,
      (select md5(coalesce(string_agg(to_jsonb(e)::text, '' order by id), '')) from public.evv_submissions e) as m`)).rows[0]
    const b4 = await snap()
    const J = await proof(pf)
    ck(`PGLITE proof (${kind}): without the choice and without a client signature: still refused`, J?.nolater?.field === 'sig_consumer', J?.nolater ?? J)
    ck(`PGLITE proof (${kind}): "client signs later": saved as waiting, linked from the visit, with a link`, J?.later?.ok === true && J?.later?.waiting === true && J?.waiting_form?.linked === true, J?.later)
    ck(`PGLITE proof (${kind}): signed at the shift: "signed", via the form`, J?.signed_now?.waiting === false && J?.signed_form?.status === 'signed' && J?.signed_form?.via === 'form', J?.signed_form)
    ck(`PGLITE proof (${kind}): the public cannot read the link table; the page gets ONLY the caregiver's part`, J?.anon_read_sign === 'refused'
      && JSON.stringify(J?.get_keys) === JSON.stringify(['caregiver_name', 'client_display', 'new_in', 'new_out', 'notes', 'orig_in', 'orig_out', 'reason', 'sig_attendant', 'status', 'submitted_on', 'tasks', 'visit_date']), J?.get_keys)
    ck(`PGLITE proof (${kind}): the tick is required; the client signature is saved; the caregiver's answers did NOT change`, J?.noconf?.field === 'confirm' && J?.sign?.ok === true
      && J?.waiting_form?.status_now === 'signed' && J?.waiting_form?.via === 'sign_link' && J?.waiting_form?.new_in === '09:00' && J?.waiting_form?.new_out === '13:00'
      && J?.waiting_form?.notes === 'proof 429, never kept' && J?.waiting_form?.processed === false && J?.waiting_form?.outcome === null && J?.waiting_form?.sig_attendant_kept === true && J?.waiting_form?.sig_consumer === true, J?.waiting_form)
    ck(`PGLITE proof (${kind}): one use (again = already signed); unknown = not_found`, J?.again?.error === 'signed' && J?.get_after?.status === 'signed' && J?.unknown?.status === 'not_found')
    ck(`PGLITE proof (${kind}): the plain form: signed = "signed", unsigned = "waiting", phone claims wiped`, J?.plain_signed === 'signed' && J?.plain_waiting === 'waiting' && J?.plain_phone_wiped === true, J)
    ck(`PGLITE proof (${kind}): staff cannot write a signature or status directly, nor accept a waiting form`, J?.staff_direct === 'refused,refused' && J?.staff_accept_waiting === 'refused', J)
    ck(`PGLITE proof (${kind}): "Verified by phone" through its step; who = the sign-in (a typed "by" ignored); then Accept works`, J?.phone?.ok === true && J?.phone_row?.status === 'phone_verified'
      && J?.phone_row?.by === 'proof-429@invalid.test' && J?.phone_row?.with === 'Proof Daughter' && J?.phone_row?.rel === 'daughter' && J?.phone_row?.confirmed === true && J?.phone_row?.call_at === true
      && J?.accept_after_phone === 1 && J?.phone_row?.outcome === 'accepted', J?.phone_row)
    ck(`PGLITE proof (${kind}): Dismiss still works; the public cannot record a phone call; the link closes`, J?.dismiss === 1 && J?.anon_phone === 'refused' && J?.sign_link_done === true && J?.anon_can?.phone === false)
    const J7 = await proof(p427), J2 = await proof(p422)
    ck(`PGLITE (${kind}): the 427 proof still passes on top of 429`, J7?.submit?.ok === true && J7?.nosig?.field === 'sig_consumer' && J7?.plain_wiped === true && J7?.saved?.both_sigs === true && J7?.again?.error === 'used', J7)
    ck(`PGLITE (${kind}): the 422 proof still passes on top of 429 (a signed public form can still be accepted by staff)`, J2?.wiped === true && J2?.staff_update === 1 && J2?.after === true && J2?.anon_read === 'refused', J2)
    const af = await snap()
    ck(`PGLITE proofs (${kind}): nothing stayed`, b4.n === af.n && b4.s === af.s && b4.p === af.p && b4.m === af.m, [b4, af])
    // more edges, each rolled back
    const as = async (role, claims, sqlText, params = []) => { await db.exec('begin'); try { if (claims) await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]); await db.exec(`set local role ${role}`); return (await db.query(sqlText, params)).rows[0] } catch (e) { return { thrown: e.message } } finally { await db.exec('rollback') } }
    const STAFF = '{"role":"authenticated","email":"k@invalid.test"}'
    const rec = (id, p) => as('authenticated', STAFF, `select public.evv_client_phone_record('${id}', $1::jsonb) as r`, [JSON.stringify(p)])
    const OLD = '00000000-0000-4000-8000-000000000002'
    const now = new Date().toISOString()
    const good = { outcome: 'phone_verified', spoke_with: 'Ann B', relationship: 'daughter', call_at: now, confirmed: true }
    const outs = []
    for (const [p, fld] of [[{ ...good, spoke_with: '' }, 'spoke_with'], [{ ...good, call_at: new Date(Date.now() + 3600e3).toISOString() }, 'call_at'], [{ ...good, call_at: 'not a time' }, 'call_at'],
      [{ ...good, confirmed: false }, 'confirmed'], [{ ...good, outcome: 'refused' }, 'notes'], [{ ...good, outcome: 'maybe' }, 'outcome'], [{ ...good, relationship: 'x'.repeat(61) }, 'relationship']]) outs.push([fld, (await rec(OLD, p))?.r])
    ck(`PGLITE (${kind}): the phone record refuses each bad answer by name (who, when, the tick, notes for "declined", outcome, lengths)`, outs.every(([f, r]) => r?.ok === false && r?.field === f), outs)
    ck(`PGLITE (${kind}): the phone record works on an OLDER unsigned waiting form; declined works with notes`, (await rec(OLD, good))?.r?.ok === true
      && (await rec(OLD, { outcome: 'refused', spoke_with: 'Ann B', call_at: now, notes: 'Ann says she was not there that day' }))?.r?.status === 'refused')
    ck(`PGLITE (${kind}): the phone record without a staff sign-in is refused (not_staff)`, (await as('authenticated', '{"role":"anon"}', `select public.evv_client_phone_record('${OLD}', $1::jsonb) as r`, [JSON.stringify(good)]))?.r?.error === 'not_staff')
    ck(`PGLITE (${kind}): an already signed form cannot be "verified by phone"; a processed one is closed`, (await rec('00000000-0000-4000-8000-000000000001', good))?.r?.error === 'closed')
    const acc = await as('authenticated', STAFF, `update public.evv_submissions set processed = true, outcome = 'accepted' where id = '${OLD}' returning id`)
    const dis = await as('authenticated', STAFF, `update public.evv_submissions set processed = true, outcome = 'dismissed' where id = '${OLD}' returning id`)
    const fb = await as('authenticated', STAFF, `update public.evv_submissions set processed = true where id = '${OLD}' returning id`)
    ck(`PGLITE (${kind}): an OLDER unsigned form cannot be accepted (or processed without an outcome); it can be dismissed`, /EVV429: the client has not signed/.test(acc?.thrown || '') && /EVV429/.test(fb?.thrown || '') && dis?.id === OLD, [acc, dis, fb])
    const lnk = await as('authenticated', STAFF, `update public.evv_submissions set caregiver_axiscare_id = '77', linked_by = 'k' where id = '${OLD}' returning id`)
    ck(`PGLITE (${kind}): staff can still link a waiting form (so its next visit can be found)`, lnk?.id === OLD, lnk)
    // the sign page: expiry and size
    await db.exec(`insert into public.evv_sign (token, submission_id, expires_at, caregiver_axiscare_id, client_axiscare_id) values ('44444444-2222-4333-8444-555555555555', '${OLD}', now() - interval '1 minute', '1', '2'),
      ('55555555-2222-4333-8444-555555555555', '${OLD}'::uuid, now() + interval '1 day', '1', '2') on conflict do nothing`).catch(() => {})
    await db.exec(`update public.evv_sign set expires_at = now() - interval '1 minute' where token = '44444444-2222-4333-8444-555555555555'`)
    const ge = await as('anon', null, `select public.evv_sign_get('44444444-2222-4333-8444-555555555555') as r`)
    const se = await as('anon', null, `select public.evv_sign_submit('44444444-2222-4333-8444-555555555555', $1::jsonb) as r`, [JSON.stringify({ confirm: true, sig_consumer: 'data:image/png;base64,iVBORw0KGgo=' })])
    await db.exec(`update public.evv_sign set expires_at = now() + interval '1 day' where token = '44444444-2222-4333-8444-555555555555'`)
    const big = await as('anon', null, `select public.evv_sign_submit('44444444-2222-4333-8444-555555555555', $1::jsonb) as r`, [JSON.stringify({ confirm: true, sig_consumer: 'data:image/png;base64,' + 'A'.repeat(1500001) })])
    const js = await as('anon', null, `select public.evv_sign_submit('44444444-2222-4333-8444-555555555555', $1::jsonb) as r`, [JSON.stringify({ confirm: true, sig_consumer: 'javascript:alert(1)' })])
    const gk = await as('anon', null, `select public.evv_sign_get('44444444-2222-4333-8444-555555555555') as r`)
    ck(`PGLITE (${kind}): the sign page: an expired link refused; an oversized or non-image signature refused; never shows ids or the client signature`,
      ge?.r?.status === 'expired' && se?.r?.error === 'expired' && big?.r?.field === 'sig_consumer' && js?.r?.field === 'sig_consumer' && gk?.r?.status === 'ok'
      && !['sig_consumer', 'caregiver_axiscare_id', 'client_axiscare_id', 'id', 'submission_id', 'token', 'phone_verified_by'].some((k) => k in (gk?.r || {})), [ge, se, big, js, gk])
    const anonSel = await as('anon', null, `select count(*) from public.evv_sign`)
    const staffIns = await as('authenticated', STAFF, `insert into public.evv_sign (submission_id) values (gen_random_uuid()) returning id`)
    ck(`PGLITE (${kind}): the link table: the public cannot read it; staff cannot write it`, /permission denied/.test(anonSel?.thrown || '') && /permission denied/.test(staffIns?.thrown || ''), [anonSel, staffIns])
    await db.close()
  }
} else console.log('(PGLITE not set: the real-Postgres run of the SQL is skipped)')

const failed = res.filter((x) => !x[1])
for (const [n, ok, note] of res) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n      ' + note}`)
console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? ' · FAIL' : ''}`)
process.exit(failed.length ? 1 : 0)
