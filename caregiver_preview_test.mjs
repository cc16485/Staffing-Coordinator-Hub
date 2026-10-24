// CAREGIVER PREVIEW (2026-10-24): the pure rules (_shared/caregiver-preview.ts), the real caregiver-preview function, and the
// readers (the shift page's details, the Booking App's About) against a fake database and fake AxisCare, with the Hub's real
// match-rules.js. Proves her rules: introduction and care summary kept apart (care is read from the care plan, never typed);
// drafts never reach caregivers; who approves; a second person for care changes that show more; a care plan change hides
// the care summary and flags review; incomplete is fine (the shift alone); Preview as Caregiver works with no shift and
// compares draft and approved; nothing on the Family Circle is lost; switch off = the readers work exactly as before.
// HUB=<care-coordinator-hub dir> node caregiver_preview_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import crypto from 'crypto'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions'), HUB = process.env.HUB || path.join(ROOT, '../cc-hub-cara-p1')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1500)])
const RULES = fs.readFileSync(path.join(HUB, 'match-rules.js'), 'utf8'); vm.runInThisContext(RULES); const MR = globalThis.CCMatch
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const CP = await import(path.join(FN, '_shared/caregiver-preview.ts'))

/* ── 1. pure rules ── */
const facts = (req, pref = []) => MR.SKILLS.map((s) => ({ episode_id: 'e1', kind: 'need_' + s.key, layer: 'plan', value: req.includes(s.key) ? 'required' : pref.includes(s.key) ? 'preferred' : 'no' }))
const items = (req, pref, level, extra = []) => CP.careItemsOf(MR, MR.fromFacts([...facts(req, pref), ...extra]), level)
const NOW = items(['dementia_care'], ['transportation'], 2, [{ episode_id: 'e1', kind: 'home_cats', layer: 'plan', value: 'yes' }])
ck('care summary from the care plan: helps with, required skills, level, pets (the match rules\' own labels)', NOW.some((x) => x.key === 'needs:dementia_care') && NOW.some((x) => x.key === 'help:transportation') && NOW.some((x) => x.key === 'level:2') && NOW.some((x) => x.key === 'home:cats'), NOW)
const SAM = { name: 'Samantha Troutman', email: 'samantha@mo-care.com', roles: ['owner_admin'] }, KRY = { name: 'Krystal Land', email: 'krystal@mo-care.com', roles: ['care_coordinator', 'springfield_lead'] }
const STF = { name: 'Sid Staffing', email: 'sid@mo-care.com', roles: ['staffing_coordinator'] }
const KEY = { client_key: 'ax:500', axiscare_client_id: '500', lead_id: null, client_name: 'Ruth Kay' }
const CIRCLE = { caregiver_about: 'Ruth loves her garden.', caregiver_enjoys: ['Gardening'], caregiver_share_care: false }
ck('carried over: until something is approved here, the Family Circle\'s About and What they enjoy count (nothing lost)', CP.approvedView(null, CIRCLE, NOW).about === 'Ruth loves her garden.' && CP.approvedIntro(null, CIRCLE).carried === true && CP.approvedView(null, CIRCLE, NOW).help.length === 0)
let r = CP.applySave(null, CIRCLE, { about: 'Ruth is a retired teacher with a quick laugh.' }, KRY, '2026-10-24T10:00:00Z', KEY).row
ck('first save starts from the Family Circle: the carried About stays in use (approved), the new words wait as a draft', r.approved_about === 'Ruth loves her garden.' && r.intro_approved_by === 'Carried over from the Family Circle' && r.draft_about === 'Ruth is a retired teacher with a quick laugh.' && r.draft_enjoys.join() === 'Gardening', r)
ck('a draft never reaches caregivers: the approved view still shows the carried About', CP.approvedView(r, CIRCLE, NOW).about === 'Ruth loves her garden.' && CP.draftView(r, CIRCLE, NOW).about.startsWith('Ruth is a retired'))
ck('state: Changes waiting for approval', CP.stateOf(r, CIRCLE, NOW).label === 'Changes waiting for approval' && CP.stateOf(r, CIRCLE, NOW).intro_pending)
ck('routine (About, What they enjoy): the coordinator who wrote it may approve it', CP.canApprove(r, CIRCLE, NOW, KRY).intro === true)
ck('staffing coordinator can edit but not approve (Samantha, Zach, Krystal or another care coordinator approves)', CP.canApprove(r, CIRCLE, NOW, STF).intro === false && /care coordinator approves/.test(CP.canApprove(r, CIRCLE, NOW, STF).why))
r = CP.applyApprove(r, CIRCLE, NOW, KRY, '2026-10-24T10:05:00Z').row
ck('approved: the new About is what caregivers see; who and when recorded', CP.approvedView(r, CIRCLE, NOW).about.startsWith('Ruth is a retired') && r.intro_approved_by === 'Krystal Land' && CP.stateOf(r, CIRCLE, NOW).label === 'Approved')
r = CP.applySave(r, CIRCLE, { share_care: true, hidden: ['help:transportation'] }, KRY, '2026-10-24T10:10:00Z', KEY).row
ck('turning on the care summary is a draft; caregivers still see no care details', CP.approvedView(r, CIRCLE, NOW).care_state === 'off' && CP.approvedView(r, CIRCLE, NOW).needs.length === 0 && CP.draftView(r, CIRCLE, NOW).needs.length === 1 && CP.draftView(r, CIRCLE, NOW).help.every((x) => !/Transport/i.test(x)))
const kc = CP.canApprove(r, CIRCLE, NOW, KRY)
ck('second look: Krystal turned on the care summary, so she can\'t approve it herself', kc.care === false && /someone else approves/.test(kc.why), kc)
ck('... Samantha can', CP.canApprove(r, CIRCLE, NOW, SAM).care === true)
r = CP.applyApprove(r, CIRCLE, NOW, SAM, '2026-10-24T10:20:00Z').row
let av = CP.approvedView(r, CIRCLE, NOW)
ck('approved care summary: only the items left ticked, the level, the pets', av.care_state === 'shown' && av.needs.length === 1 && av.level === 2 && av.home.includes('Cats in the home') && !av.help.some((x) => /Transport/i.test(x)), av)
r = CP.applySave(r, CIRCLE, { hidden: ['help:transportation', 'home:cats'] }, KRY, '2026-10-24T11:00:00Z', KEY).row
ck('hiding one more item only shows caregivers less, so the same person may approve it', CP.canApprove(r, CIRCLE, NOW, KRY).care === true)
r = CP.applyApprove(r, CIRCLE, NOW, KRY, '2026-10-24T11:01:00Z').row
r = CP.applySave(r, CIRCLE, { hidden: [] }, KRY, '2026-10-24T11:05:00Z', KEY).row
ck('showing an item again is more for caregivers: a second person', CP.canApprove(r, CIRCLE, NOW, KRY).care === false && CP.canApprove(r, CIRCLE, NOW, SAM).care === true)
r = CP.applyApprove(r, CIRCLE, NOW, SAM, '2026-10-24T11:06:00Z').row
const CHANGED = items(['dementia_care', 'hoyer_lift'].filter((k) => MR.SKILLS.some((s) => s.key === k)).concat(MR.SKILLS[3] ? [MR.SKILLS[3].key] : []), ['transportation'], 2, [{ episode_id: 'e1', kind: 'home_cats', layer: 'plan', value: 'yes' }])
av = CP.approvedView(r, CIRCLE, CHANGED)
ck('the care plan changed after approval: the care summary stops showing at once and the profile says review', CP.careSig(CHANGED) !== CP.careSig(NOW) && av.care_state === 'review' && av.needs.length === 0 && av.help.length === 0 && av.level === null && CP.stateOf(r, CIRCLE, CHANGED).label === 'Care plan changed: review', av)
ck('... the introduction still shows (only the care part is held back)', av.about.startsWith('Ruth is a retired'))
ck('... nobody changed anything, so any approver can approve the review', CP.canApprove(r, CIRCLE, CHANGED, KRY).care === true)
ck('a level change counts as a care plan change too', CP.approvedView(r, CIRCLE, items(['dementia_care'], ['transportation'], 3, [{ episode_id: 'e1', kind: 'home_cats', layer: 'plan', value: 'yes' }])).care_state === 'review')
ck('care plan unreadable: no care items shown, and no false review', CP.approvedView(r, CIRCLE, null).care_state === 'unread' && CP.approvedView(r, CIRCLE, null).needs.length === 0 && CP.canApprove(r, CIRCLE, null, SAM).care === false)
ck('incomplete is fine: nothing approved = Not started, and the shift alone shows', CP.stateOf(null, null, NOW).label === 'Not started' && CP.approvedView(null, null, NOW).about === null)
ck('the About: under 400 characters, no street address', CP.cleanAbout('x'.repeat(401)).ok === false && CP.cleanAbout('She lives at 123 Main Street').ok === false && CP.cleanAbout('Ruth loves gardening.').ok)
ck('What they enjoy: up to 6, short, no numbers', CP.cleanEnjoys(['a', 'b', 'c', 'd', 'e', 'f', 'g']).ok === false && CP.cleanEnjoys(['x'.repeat(31)]).ok === false && CP.cleanEnjoys('Gardening, Old movies').items.length === 2)
ck('history: each change and approval recorded with who', r.history.length >= 6 && r.history.some((h) => /approved the care summary/.test(h.what) && h.by === 'Samantha Troutman'))
ck('sample shift for the preview: next Saturday, 8am to 12pm, marked as a sample', CP.sampleShift('2026-10-24').shift_date === '2026-10-31' && CP.sampleShift('2026-10-24').sample === true)

/* ── 2. the real function, and the readers ── */
let T, APP
const SVC = 'svc_' + 'k'.repeat(60)
const reset = (settings = {}) => {
  APP = { ops_settings: settings }
  T = { client_caregiver_profile: [], care_circles: [{ id: 'cc1', axiscare_client_id: '500', active: true, client_name: 'Ruth Kay', caregiver_about: 'Ruth loves her garden.', caregiver_enjoys: ['Gardening'], caregiver_share_care: false }],
    person_source_id: [{ person_id: 'p1', system: 'axiscare', entity_type: 'client', source_id: '500' }], journey_episode: [{ episode_id: 'e1', person_id: 'p1', state: 'established', created_at: '2026-01-01' }],
    client_fact_current: [...facts(['dementia_care'], ['transportation']), { episode_id: 'e1', kind: 'home_cats', layer: 'plan', value: 'yes' }],
    rules_approved: [{ file: 'match-rules.js', sha256: sha(RULES) }],
    staff_roles: [{ person_id: 'ps', role: 'owner_admin', entity: 'cc_ihs' }, { person_id: 'pz', role: 'owner_admin', entity: 'cc_ihs' }, { person_id: 'pk', role: 'care_coordinator', entity: 'cc_ihs' }],
    persons: [{ person_id: 'ps', full_name: 'Samantha Troutman', active: true }, { person_id: 'pz', full_name: 'Zach Troutman', active: true }, { person_id: 'pk', full_name: 'Krystal Land', active: true }] }
}
const EVENTS = []
const q = (t) => { const st = { f: [], inF: [] }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, gte() { return b }, ilike() { return b }, or() { return b }, is() { return b }, not() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF.push([c, v]); return b },
  update(vals) { return { eq: (c, v) => { const rows = (T[t] ||= []); const i = rows.findIndex((x) => x[c] === v); if (i >= 0) rows[i] = { ...rows[i], ...vals }; return Promise.resolve({ data: null, error: null }) } } },
  insert(row) { if (t === 'op_events') EVENTS.push(row); else (T[t] ||= []).push({ id: 'id' + Math.random().toString(36).slice(2), ...row }); return Promise.resolve({ data: null, error: null }) },
  upsert() { return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })) }, single() { return b.maybeSingle() },
  then(ok, bad) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok, bad) }
    let rr = T[t] ?? []; for (const [c, v] of st.f) rr = rr.filter((x) => x[c] === v); for (const [c, v] of st.inF) rr = rr.filter((x) => v.includes(x[c]))
    return Promise.resolve({ data: rr, error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }), auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }
let AXDOWN = false, LEVEL = 'Level 2'; const AIQ = [], AIREQ = []
globalThis.fetch = async (url, o) => {
  url = String(url)
  if (url.startsWith('https://cc.mo-care.com/match-rules.js')) return new Response(RULES, { status: 200 })
  if (url.startsWith('https://api.anthropic.com/')) { AIREQ.push(JSON.parse(o.body)); const a = AIQ.shift() || { enough: false, about: '', enjoys: [], used: [], left_out: [] }; return new Response(JSON.stringify(a.refusal ? { stop_reason: 'refusal', content: [] } : { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(a) }] }), { status: 200 }) }
  if (url.includes('axiscare.com')) return AXDOWN ? new Response('', { status: 503 }) : new Response(JSON.stringify({ results: { client: { firstName: 'Ruth', lastName: 'Kay', classes: [{ label: LEVEL }], residentialAddress: { street1: '123 Main St', city: 'Nixa' } } } }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', ANTHROPIC_API_KEY: 'sk-test' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const WHO = { 'Bearer sam': ['Samantha Troutman', 'samantha@mo-care.com', ['owner_admin']], 'Bearer kry': ['Krystal Land', 'krystal@mo-care.com', ['care_coordinator']], 'Bearer sid': ['Sid Staffing', 'sid@mo-care.com', ['staffing_coordinator']] }
fs.writeFileSync(`${FN}/_shared/_staff_stub_cgp.ts`, `export const OFFICE_ROLES = ['owner_admin','care_coordinator','staffing_coordinator']\nconst W: any = ${JSON.stringify(WHO)}\nexport async function requireStaff(_sb: any, req: Request) { const w = W[req.headers.get('authorization') || '']; return w ? { ok: true, name: w[0], email: w[1], person_id: 'p', roles: w[2] } : { ok: false, status: 401, error: 'Sign in first.' } }\n`)
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_staff_stub_cgp.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/caregiver-preview/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff_stub_cgp.ts'")
const tmp = path.join(FN, 'caregiver-preview', '_cgp.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const post = async (body, auth) => { const rr = await handler(new Request('https://x/functions/v1/caregiver-preview', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) })); return [rr.status, await rr.json()] }
const C = { axiscare_client_id: '500', client_name: 'Ruth Kay' }
let s, j
reset()
;[s, j] = await post({ action: 'get', ...C })
ck('office only: no Hub sign-in, nothing', s === 401)
;[s, j] = await post({ action: 'get', ...C }, 'Bearer kry')
ck('get: works with the switch off (practice); the carried-over About shows as in use; the care plan\'s items listed', s === 200 && j.live === false && j.intro.approved.about === 'Ruth loves her garden.' && j.intro.carried === true && j.care.readable && j.care.items.some((x) => x.key === 'needs:dementia_care') && j.state.label === 'Approved', j)
ck('get: who can approve is named from the roles (Samantha, Zach, Krystal)', ['Samantha', 'Zach', 'Krystal'].every((n) => j.approvers.includes(n)), j.approvers)
;[s, j] = await post({ action: 'save', ...C, about: 'Ruth taught third grade for 30 years and loves to laugh.', enjoys: ['Gardening', 'Old movies'] }, 'Bearer kry')
ck('save: a draft; the record is made with the Family Circle carried across; the approved About is unchanged', s === 200 && T.client_caregiver_profile.length === 1 && j.intro.draft.about.startsWith('Ruth taught') && j.intro.approved.about === 'Ruth loves her garden.' && j.state.intro_pending && j.can.approve_intro, j)
;[s, j] = await post({ action: 'save', ...C, about: 'Lives at 22 Elm Street' }, 'Bearer kry')
ck('save refuses an address', s === 400 && /address/.test(j.error))
;[s, j] = await post({ action: 'preview', ...C, version: 'draft' }, 'Bearer kry')
const pd = j
;[s, j] = await post({ action: 'preview', ...C, version: 'approved' }, 'Bearer kry')
ck('Preview as Caregiver with no open shift: a sample shift; draft and approved side by side differ', s === 200 && pd.sample && pd.about.startsWith('Ruth taught') && j.about === 'Ruth loves her garden.' && pd.enjoys.join() === 'Gardening,Old movies' && /to 12pm/.test(j.time), [pd, j])
ck('preview: no last name, no street, no address; "Hi there" (no caregiver chosen)', !/Kay|Main St|123/.test(JSON.stringify(pd)) && pd.caregiver_first === 'there' && pd.town === 'Nixa')
;[s, j] = await post({ action: 'save', ...C, share_care: true }, 'Bearer kry')
;[s, j] = await post({ action: 'approve', ...C }, 'Bearer kry')
ck('Krystal approves: her introduction goes through; her own care summary waits for a second person (said plainly)', s === 200 && j.approved.join() === 'the introduction' && /someone else approves/.test(j.note) && j.intro.approved.about.startsWith('Ruth taught') && j.care.approved_on === false, j)
;[s, j] = await post({ action: 'approve', ...C }, 'Bearer sid')
ck('a staffing coordinator can\'t approve', s === 409 && /approves Caregiver Previews/.test(j.error), j)
;[s, j] = await post({ action: 'approve', ...C }, 'Bearer sam')
ck('Samantha approves the care summary; state Approved, by Samantha', s === 200 && j.care.approved_on && j.state.label === 'Approved' && j.history[0].by === 'Samantha Troutman', j)
ck('every step recorded in the activity log', EVENTS.filter((e) => e.verb === 'caregiver_preview_approved').length === 2 && EVENTS.some((e) => e.verb === 'caregiver_preview_draft'))

/* the readers */
const SK = await import(path.join(FN, '_shared/cara-skills.ts'))
const CL = { classes: [{ label: 'Level 2' }] }
let inf = await SK.clientInfoFor(globalThis.__db, '500', CL)
ck('switch OFF: the shift page reads the Family Circle as before (care needs off there)', inf.about === 'Ruth loves her garden.' && inf.needs.length === 0, inf)
APP.ops_settings = { caregiver_preview_live: true }
inf = await SK.clientInfoFor(globalThis.__db, '500', CL)
ck('switch ON: the shift page reads only the approved Caregiver Preview (introduction + approved care summary)', inf.about.startsWith('Ruth taught') && inf.enjoys.join() === 'Gardening,Old movies' && inf.needs.length === 1 && inf.level === 2 && inf.home.includes('Cats in the home'), inf)
await post({ action: 'save', ...C, about: 'A draft nobody approved' }, 'Bearer kry')
inf = await SK.clientInfoFor(globalThis.__db, '500', CL)
ck('switch ON: a new draft does not reach the shift page', inf.about.startsWith('Ruth taught'), inf)
T.client_fact_current.push({ episode_id: 'e1', kind: 'home_dogs', layer: 'plan', value: 'yes' })
inf = await SK.clientInfoFor(globalThis.__db, '500', CL)
ck('switch ON: the care plan changed (a dog): no care details on the shift page until reviewed; the introduction stays', inf.needs.length === 0 && inf.home.length === 0 && inf.level === null && inf.about.startsWith('Ruth taught'), inf)
;[s, j] = await post({ action: 'get', ...C }, 'Bearer kry')
ck('... and the tab says Care plan changed: review, showing the new item', j.state.label === 'Care plan changed: review' && j.care.items.some((x) => x.key === 'home:dogs'), j.state)
const FO = fs.readFileSync(`${FN}/_shared/family-offer-db.ts`, 'utf8')
ck('Booking App: its About reads the same approved Caregiver Preview when the switch is on', /caregiver_preview_live === true[\s\S]{0,200}approvedIntro\(row, circle\)\.about/.test(FO))
ck('Cara\'s matching never reads the Caregiver Preview (care requirements come from the care plan)', !/client_caregiver_profile|caregiver-preview/.test(fs.readFileSync(`${FN}/_shared/match-dark.ts`, 'utf8') + fs.readFileSync(`${FN}/_shared/cara-list.ts`, 'utf8')))
T.client_caregiver_profile = []; APP.ops_settings = { caregiver_preview_live: true }
inf = await SK.clientInfoFor(globalThis.__db, '500', CL)
ck('switch ON, nothing saved here yet: the Family Circle About carries over (nothing lost), no care details', inf.about === 'Ruth loves her garden.' && inf.needs.length === 0, inf)
reset({ caregiver_preview_live: true }); T.care_circles = []
inf = await SK.clientInfoFor(globalThis.__db, '500', CL)
ck('incomplete: no profile and no circle = the shift alone', inf.about === null && inf.enjoys.length === 0 && inf.needs.length === 0, inf)
reset()
;[s, j] = await post({ action: 'save', lead_id: 'lead-9', client_name: 'New Client', about: 'Bea loves birds.' }, 'Bearer kry')
ck('a client not in AxisCare yet: a draft can be written (kept on the lead)', s === 200 && T.client_caregiver_profile.some((x) => x.lead_id === 'lead-9' && x.draft_about === 'Bea loves birds.') && j.care.readable === false, j)
;[s, j] = await post({ action: 'get', axiscare_client_id: '777', lead_id: 'lead-9' }, 'Bearer kry')
ck('... and it follows them once they have an AxisCare id (the shift page finds it by AxisCare id)', s === 200 && j.intro.draft.about === 'Bea loves birds.' && T.client_caregiver_profile.find((x) => x.lead_id === 'lead-9').axiscare_client_id === '777', j)

/* ── 3. her check (2026-10-24): the Booking App and Cara use only the approved introduction; never a draft, never a
   private care-plan note ── */
{
  const FOD = await import(path.join(FN, '_shared/family-offer-db.ts'))
  reset({ caregiver_preview_live: true })
  T.client_fact_current.push({ episode_id: 'e1', kind: 'care_notes', layer: 'plan', value: 'Diagnosed with Parkinsons; her son is difficult' }, { episode_id: 'e1', kind: 'door_code', layer: 'plan', value: '4411' }, { episode_id: 'e1', kind: 'medications', layer: 'current', value: 'Sinemet 25/100' })
  await post({ action: 'save', ...C, about: 'Ruth taught school for 30 years.', enjoys: ['Gardening'] }, 'Bearer kry')
  await post({ action: 'approve', ...C }, 'Bearer kry')
  await post({ action: 'save', ...C, share_care: true }, 'Bearer kry')
  await post({ action: 'approve', ...C }, 'Bearer sam')
  await post({ action: 'save', ...C, about: 'DRAFT: not approved words' }, 'Bearer kry')
  const deps = FOD.chooseDepsFor(globalThis.__db, async () => ({ status: 0, json: {} }), 'https://x.supabase.co')
  const about = await deps.clientAbout('500')
  ck('Booking App (the real reader): the approved About, never the draft', about === 'Ruth taught school for 30 years.', about)
  const inf2 = await SK.clientInfoFor(globalThis.__db, '500', CL)
  ck('Cara\'s shift page (the real reader): the approved About, never the draft', inf2.about === 'Ruth taught school for 30 years.' && !/DRAFT/.test(JSON.stringify(inf2)), inf2)
  const [, pa] = await post({ action: 'preview', ...C, version: 'approved' }, 'Bearer kry')
  const blob = JSON.stringify([about, inf2, pa])
  ck('no private care-plan notes reach caregivers: no diagnosis, family note, door code or medication, only the match rules\' fixed labels', !/Parkinson|son is difficult|4411|Sinemet/.test(blob) && inf2.needs.length >= 1, blob.slice(0, 600))
  const [, pd2] = await post({ action: 'preview', ...C, version: 'draft' }, 'Bearer kry')
  ck('the draft is only in the office\'s own preview (labelled draft)', pd2.version === 'draft' && /DRAFT/.test(pd2.about) && pa.version === 'approved' && !/DRAFT/.test(pa.about))
  APP.ops_settings = {}
  ck('switch off: the Booking App reads Family & Contacts exactly as before', (await deps.clientAbout('500')) === 'Ruth loves her garden.')
}

/* ── 4. step 2: the AI draft from the Life Story (2026-10-24) ── */
{
  const LD = await import(path.join(FN, '_shared/life-story-draft.ts'))
  const PROF = { id: 'cp_ax500', life: { work: { text: 'Taught third grade for 30 years. Loves her rose garden.', by: 'Krystal Land', via: 'intake call', at: '2026-10-14' }, enjoys: { text: 'Her grandkids, old movies, the Cardinals', by: 'Krystal Land', via: 'intake call', at: '2026-10-14' } }, life_story: 'Has dementia and her son Mark is difficult. Loves coffee.' }
  const LEAD = { id: 'lead-r', axiscare_client_id: '500', life: { work: { text: 'old lead answer' }, little: { text: 'Coffee and a cookie in the afternoon', by: 'Samantha Troutman', via: 'assessment', at: '2026-10-20' } } }
  const src = LD.lifeSources(PROF, LEAD)
  ck('Life Story sources: the profile wins, the inquiry fills the gap, the free-text box is included (labelled)', src.length === 4 && src[0].text.startsWith('Taught') && src.find((x) => x.key === 'little').via === 'assessment' && src.find((x) => x.key === 'more').label === 'Anything else about who they are', src)
  ck('checks: health, family and money words are caught; ordinary interests are not', LD.sensitiveHit('She has dementia') === 'dementia' && LD.sensitiveHit('pays the bills') && LD.sensitiveHit('loves old movies and roses') === null && LD.sensitiveHit('likes fall leaves') === null)
  ck('checks: an item is kept only if it shares a real word with the Life Story', LD.grounded('Rose gardening', 'Loves her rose garden') && LD.grounded('Old movies', 'old movies') && !LD.grounded('Knitting', 'Loves her rose garden'))
  ck('checks: people named in the Life Story (her son Mark, Laura, her daughter) and the caller are found', JSON.stringify(LD.peopleNames('Has dementia and her son Mark is difficult. Laura, her daughter, visits.', ['Laura', 'Johnson']).sort()) === JSON.stringify(['Johnson', 'Laura', 'Mark']), LD.peopleNames('Has dementia and her son Mark is difficult. Laura, her daughter, visits.', ['Laura', 'Johnson']))
  ck('checks: names or places not in the Life Story are caught (the client\'s first name and months are fine)', JSON.stringify(LD.unknownNames('Ruth loves the Cardinals and visits Branson in May.', 'the Cardinals', 'Ruth')) === '["Branson"]')
  reset({}); APP.client_profiles = [PROF]; APP.leads = [LEAD]
  ;[s, j] = await post({ action: 'draft', ...C }, 'Bearer kry')
  ck('switch off: a coordinator can\'t draft yet (practice is owners only)', s === 403 && /practice/.test(j.error), j)
  AIQ.push({ enough: true, about: 'Ruth taught third grade for 30 years and still loves her rose garden. She enjoys talking about her grandkids, an old movie, and a good Cardinals game.', enjoys: ['Rose gardening', 'Old movies', 'Cardinals baseball', 'Her grandkids', 'Coffee', 'Knitting'], used: [1, 2, 3], left_out: ['a health detail', 'a family matter'] })
  ;[s, j] = await post({ action: 'draft', ...C }, 'Bearer sam')
  ck('owner, switch off: a draft from the Life Story; an item not in it ("Knitting") is dropped; sources and left-out kinds returned', s === 200 && j.ok && /rose garden/.test(j.draft.about) && j.draft.enjoys.join() === 'Rose gardening,Old movies,Cardinals baseball,Her grandkids,Coffee' && JSON.stringify(j.draft.dropped) === '["Knitting"]' && j.draft.sources.length === 3 && j.draft.left_out.includes('a health detail'), j)
  const req = AIREQ.pop()
  ck('the AI is sent only the Life Story (not the care plan, notes or diagnosis facts), with the rules, on Claude Opus 5.5, no temperature, a JSON answer', req.model === 'claude-opus-5-5' && !('temperature' in req) && req.output_config.format.type === 'json_schema' && /Use only facts that are in the sources/.test(req.system) && /\[1\] Work and life: Taught third grade/.test(req.messages[0].content) && !/dementia_care|need_|Level 2/.test(req.messages[0].content), req.messages[0].content)
  ck('nothing is saved by drafting', T.client_caregiver_profile.length === 0 && EVENTS.some((e) => e.verb === 'caregiver_preview_ai_draft'))
  AIREQ.length = 0
  AIQ.push({ enough: true, about: 'Ruth has dementia but loves her rose garden.', enjoys: ['Roses'], used: [1], left_out: [] }, { enough: true, about: 'Ruth loves her rose garden and old movies.', enjoys: ['Roses', 'Old movies'], used: [1, 2], left_out: ['a health detail'] })
  ;[s, j] = await post({ action: 'draft', ...C }, 'Bearer sam')
  ck('a draft that mentions a health detail is sent back once with the reason; the clean second draft is used', j.ok && !/dementia/i.test(j.draft.about) && AIREQ.length === 2 && /mentioned "dementia"/.test(AIREQ[1].messages[0].content), [j, AIREQ.length])
  AIQ.push({ enough: true, about: 'Ruth loves visits from Mark.', enjoys: [], used: [4], left_out: [] }, { enough: true, about: 'Ruth loves visits from Mark and Jenny.', enjoys: [], used: [4], left_out: [] })
  ;[s, j] = await post({ action: 'draft', ...C }, 'Bearer sam')
  ck('a draft that keeps naming people or places not in the Life Story is refused (write it yourself)', j.ok === false && /write this one yourself/.test(j.why) && /belong to other people/.test(j.why) && /Mark/.test(j.why), j)
  AIQ.push({ enough: false, about: '', enjoys: [], used: [], left_out: [] })
  ;[s, j] = await post({ action: 'draft', ...C }, 'Bearer sam')
  ck('not enough to go on: says so, writes nothing', j.ok === false && /isn't enough in Ruth Life Story|isn't enough in Ruth/.test(j.why), j)
  AIQ.push({ refusal: true })
  ;[s, j] = await post({ action: 'draft', ...C }, 'Bearer sam')
  ck('the AI declines: says so', j.ok === false && /declined/.test(j.why), j)
  APP.client_profiles = []; APP.leads = []; AIREQ.length = 0
  ;[s, j] = await post({ action: 'draft', ...C }, 'Bearer sam')
  ck('an empty Life Story: nothing sent to the AI, and it says what to do', j.ok === false && /Nothing in Ruth Life Story yet|Nothing in Ruth/.test(j.why) && AIREQ.length === 0, j)
  APP.ops_settings = { cgp_ai_draft_live: true }; APP.client_profiles = [PROF]; AIQ.push({ enough: true, about: 'Ruth loves her rose garden.', enjoys: ['Roses'], used: [1], left_out: [] })
  ;[s, j] = await post({ action: 'draft', ...C }, 'Bearer kry')
  ck('switch on: a coordinator can draft', s === 200 && j.ok, j)
  ;[s, j] = await post({ action: 'save', ...C, about: 'Ruth loves her rose garden.', enjoys: ['Roses'], ai_draft: true }, 'Bearer kry')
  ck('saving it: a draft like any other, and the history says it came from an AI draft (approval still needed)', s === 200 && j.state.intro_pending && /\(from an AI draft\)/.test(j.history[0].what), j.history)
}

const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log(okk ? '  ✓' : '  ✗', n, okk ? '' : note)
console.log(`\n${res.length - bad.length}/${res.length} passed`)
process.exit(bad.length ? 1 : 0)
