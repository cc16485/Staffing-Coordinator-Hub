// Caregiver profile, slice 2b (Desktop 410): both family messages use the ONE caregiver profile card.
// The card-link rules (AxisCare id first, unique full name only, published only), the link format, caregiver-card run
// against a fake database (no private field ever leaves, ?legacy= for old meet.html links), the older-profile rules in
// caregiver-profile, scans of the migration SQL (idempotent, one transaction, nothing dropped) and of the Hub files.
//   node caregiver_profile_2b_test.mjs            (HUB=<path to cc-hub-live> to also scan the Hub; default ../cc-hub-live)
//   PGLITE=<path to @electric-sql/pglite> node caregiver_profile_2b_test.mjs   also runs the SQL twice in a real Postgres
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const DASH = /[\u2014\u2015]/
const load = async (rel, swaps = []) => {
  let src = fs.readFileSync(rel, 'utf8'); for (const [a, b] of swaps) src = src.replace(a, b)
  const tmp = path.join(path.dirname(rel), '_t2b_' + path.basename(rel)); fs.writeFileSync(tmp, src)
  try { return await import(path.resolve(tmp)) } finally { fs.unlinkSync(tmp) }
}

// ── 1. the card-link rules (pure) ──
const L = await load(`${FN}/_shared/caregiver-card-link.ts`)
const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const P = (n, o) => ({ id: U(n), first_name: 'Sarah', last_name: 'Thompson', preferred_name: null, axiscare_id: null, published: true, status: 'approved', ...o })
let r = L.pickProfile([P(1, { axiscare_id: '501' }), P(2, { first_name: 'Other', last_name: 'Name', axiscare_id: '777' })], { axiscareId: '777', name: 'Sarah Thompson' })
ck('AxisCare id wins over a name match (the profile with their id, even when another profile has the name)', r.profile?.id === U(2) && r.how === 'axiscare_id', r)
r = L.pickProfile([P(1, { axiscare_id: '501', published: false }), P(2)], { axiscareId: '501', name: 'Sarah Thompson' })
ck('an unpublished profile is never linked, even by id; then a unique published name match is used', r.profile?.id === U(2) && r.how === 'name', r)
r = L.pickProfile([P(1, { axiscare_id: '501' }), P(2, { axiscare_id: '501' })], { axiscareId: '501', name: 'Sarah Thompson' })
ck('two published profiles with the same AxisCare id: no link (a person must fix it)', r.profile === null && r.how === 'none', r)
r = L.pickProfile([P(1), P(2)], { name: 'Sarah Thompson' })
ck('two published profiles with the same full name: no link', r.profile === null, r)
r = L.pickProfile([P(1), P(2, { published: false }), P(3, { status: 'withdrawn' })], { name: '  sarah   THOMPSON ' })
ck('exactly one published name match: linked (case and spaces do not matter; unpublished and withdrawn do not count)', r.profile?.id === U(1) && r.how === 'name', r)
r = L.pickProfile([P(1, { status: 'withdrawn' })], { name: 'Sarah Thompson' })
ck('a withdrawn profile is never linked', r.profile === null, r)
r = L.pickProfile([P(1, { first_name: 'Sarah', preferred_name: 'Sally' })], { name: 'Sally Thompson' })
ck('preferred name + last name also matches', r.profile?.id === U(1), r)
r = L.pickProfile([P(1)], { name: 'Sarah' })
ck('only a first name to go on: no link', r.profile === null, r)
r = L.pickProfile([P(1, { last_name: null })], { name: 'Sarah Thompson' })
ck('a profile with no last name is never a name match', r.profile === null, r)
r = L.pickProfile([P(1, { axiscare_id: '999' })], { axiscareId: '501', name: 'Sarah Thompson' })
ck('a name match tied to a DIFFERENT AxisCare id than the one we know is someone else: no link', r.profile === null, r)
r = L.pickProfile([P(1, { id: 'not-a-uuid' })], { name: 'Sarah Thompson' })
ck('a profile without a proper card id is never linked', r.profile === null, r)
ck('the covering AxisCare id: the confirmed assignment first', L.coveringAxiscareId({ covered_by: 'Sarah Thompson', axiscare_assignment: { status: 'assigned', caregiver_id: '501' }, asked: [{ name: 'Sarah Thompson', axiscare_id: '777' }] }) === '501')
ck('then the one asked caregiver with that name', L.coveringAxiscareId({ covered_by: 'Sarah Thompson', axiscare_assignment: { status: 'by_hand' }, asked: [{ name: 'sarah thompson', axiscare_id: '777' }, { name: 'Bo Lee', axiscare_id: '1' }] }) === '777')
ck('two asked people with that name and different ids: no id', L.coveringAxiscareId({ covered_by: 'Sarah Thompson', asked: [{ name: 'Sarah Thompson', axiscare_id: '1' }, { name: 'Sarah Thompson', axiscare_id: '2' }] }) === '')
ck('link format: https://cc.mo-care.com/caregiver.html?id=<uuid>', L.cardLink(U(5)) === 'https://cc.mo-care.com/caregiver.html?id=' + U(5))
ck('{meet} wording: " Meet Sarah here: <link>" (preferred name first), and nothing at all without a card',
  L.meetLine(P(5)) === ' Meet Sarah here: https://cc.mo-care.com/caregiver.html?id=' + U(5) && L.meetLine(P(5, { preferred_name: 'Sally' })).startsWith(' Meet Sally here:')
  && L.meetLine(null) === '' && L.meetLine(P(5, { published: false })) === '' && !DASH.test(L.meetLine(P(5))))
ck('card name is "First L." and never more of the last name', L.cardName(P(1)) === 'Sarah T.' && L.cardName(P(1, { last_name: null })) === 'Sarah' && L.cardName(P(1, { preferred_name: 'Sally', last_name: "o'Neil" })) === 'Sally O.')
let QUERIES = []
const fakeSb = (rows, err) => ({ from: (t) => { const q = { t, f: [] }; QUERIES.push(q); const b = { select() { return b }, eq(k, v) { q.f.push([k, v]); return b },
  then(ok) { return Promise.resolve({ data: err ? null : rows.filter((x) => q.f.every(([k, v]) => x[k] === v)), error: err || null }).then(ok) } }; return b } })
r = await L.findCardForCase(fakeSb([P(1, { published: false }), P(2, { axiscare_id: '501' })]), { covered_by: 'Sarah Thompson', axiscare_assignment: { status: 'assigned', caregiver_id: '501' } })
ck('server side: reads caregiver_profiles asking for published only, and picks by id', r.profile?.id === U(2) && QUERIES[0].t === 'caregiver_profiles' && QUERIES[0].f.some(([k, v]) => k === 'published' && v === true), [r, QUERIES])
r = await L.findCardForCase(fakeSb([], { message: 'boom' }), { covered_by: 'Sarah Thompson' })
ck('server side: a database error means no link, never a crash (the text still goes)', r.profile === null && r.how === 'none', r)

// ── 2. caregiver-card, run against a fake database ──
let ROWS = [], LASTQ = null
globalThis.__cdb = { from: () => { const q = { f: [] }; LASTQ = q; const b = { select(c) { q.cols = c; return b }, eq(k, v) { q.f.push((x) => x[k] === v); return b }, neq(k, v) { q.f.push((x) => x[k] !== v); return b },
  maybeSingle() { const hit = ROWS.filter((x) => q.f.every((g) => g(x))); return Promise.resolve({ data: hit[0] ? { ...hit[0] } : null, error: null }) } }; return b } }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb', SUPABASE_SERVICE_ROLE_KEY: 'k' })[k] }, serve: (h) => { handler = h } }
const C = await load(`${FN}/caregiver-card/index.ts`, [[/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__cdb']])
const get = async (qs) => { const x = await handler(new Request('https://x/caregiver-card?' + qs)); return [x.status, await x.json()] }
const FULL = { id: U(10), first_name: 'Sarah', last_name: 'Thompson', preferred_name: null, photo_path: null, photo_url: 'https://old/photo.jpg', video_path: null, experience: null,
  years_experience: null, specialties: [], about: 'Sarah is kind.', why_this_work: null, published: true, status: 'approved', axiscare_id: '501', candidate_id: 'c9',
  upload_token: U(99), consent: false, legacy_intro_id: 'legacy-1', needs_review: true, applicant_id: U(98), caregiver_id: 'r1' }
ROWS = [FULL, { ...FULL, id: U(11), published: false, legacy_intro_id: 'legacy-2' }, { ...FULL, id: U(12), status: 'withdrawn', legacy_intro_id: 'legacy-3' }]
let [s, j] = await get('id=' + U(10))
const ALLOWED = ['id', 'name', 'first', 'photo', 'video', 'experience', 'years', 'specialties', 'about', 'why']
ck('a published card answers with "Sarah T." and only the family fields: never the last name, AxisCare id, candidate id, token or consent',
  s === 200 && j.name === 'Sarah T.' && j.first === 'Sarah' && Object.keys(j).every((x) => ALLOWED.includes(x))
  && !/Thompson|501|c9|legacy|99|98|"r1"|consent|needs_review/.test(JSON.stringify(j)), j)
ck('the database is asked only for card columns (no token, ids or consent trail)', !/upload_token|axiscare_id|candidate_id|consent|caregiver_id|applicant_id/.test(LASTQ.cols), LASTQ.cols)
ck('an older intro\'s https photo is used while there is no uploaded photo', j.photo === 'https://old/photo.jpg', j)
ROWS[0] = { ...FULL, photo_path: U(10) + '/photo-1.jpg' }; [s, j] = await get('id=' + U(10))
ck('an uploaded photo always wins over the older photo address', j.photo === 'https://sb/storage/v1/object/public/caregiver-profiles/' + U(10) + '/photo-1.jpg', j)
ROWS[0] = { ...FULL, photo_url: 'http://insecure/x.jpg' }; [s, j] = await get('id=' + U(10))
ck('a non-https older photo address is never shown', j.photo === null, j)
ROWS[0] = FULL
;[s, j] = await get('id=' + U(11)); const [s2] = await get('id=' + U(12)); const [s3] = await get('id=' + U(13)); const [s4] = await get('id=nope')
ck('unpublished, withdrawn, unknown and malformed ids are all the same 404', s === 404 && s2 === 404 && s3 === 404 && s4 === 404 && j.error === 'not_found')
;[s, j] = await get('legacy=legacy-1')
ck('?legacy=<old meet.html id> opens the moved profile, with its public card id for the redirect', s === 200 && j.id === U(10) && j.name === 'Sarah T.', j)
const [l2] = await get('legacy=legacy-2'), [l3] = await get('legacy=legacy-3'), [l4] = await get('legacy=unknown'), [l5] = await get("legacy=x'%20or%201=1")
ck('?legacy= for an unpublished, withdrawn, unknown or odd-shaped id: 404', l2 === 404 && l3 === 404 && l4 === 404 && l5 === 404, [l2, l3, l4, l5])
ck('the card payload builder is the same rule with a preferred name', C.cardPayload({ ...FULL, preferred_name: 'Sally' }, 'b/').name === 'Sally T.')
const cardSrc = fs.readFileSync(`${FN}/caregiver-card/index.ts`, 'utf8')
ck('caregiver-card keeps CORS and the published + not-withdrawn gate', /'Access-Control-Allow-Origin': '\*'/.test(cardSrc) && /!data\.published \|\| data\.status === 'withdrawn'/.test(cardSrc) && !/upload_token/.test(cardSrc))

// ── 3. family-change-text uses the helper; meet.html is gone from the messages ──
const fct = fs.readFileSync(`${FN}/_shared/family-change-text.ts`, 'utf8')
ck('the caregiver-change text links the profile card through the shared helper, never meet.html or caregiver_intros',
  /import \{ findCardForCase, meetLine \} from '\.\/caregiver-card-link\.ts'/.test(fct) && /meetLine\(\(await findCardForCase\(sb, c\)\)\.profile\)/.test(fct)
  && !/meet\.html/.test(fct.replace(/\/\*[\s\S]*?\*\//g, '')) && !/caregiver_intros/.test(fct))
ck('the {meet} token and the automatic send rules are unchanged (approval, gate, ghlSendChecked)', /\.replaceAll\('\{meet\}', meet\)/.test(fct) && /family_caregiver_change_text_approved/.test(fct)
  && /explicitlyEnabled: true/.test(fct) && /ghlSendChecked\(/.test(fct))
const intro = fs.readFileSync(`${FN}/caregiver-intro/index.ts`, 'utf8')
ck('the introduce message still links caregiver.html?id= and only for a published, not withdrawn profile', /PROFILE_BASE = 'https:\/\/cc\.mo-care\.com\/caregiver\.html\?id='/.test(intro) && /!p\.published \|\| p\.status === 'withdrawn'/.test(intro))
const strip = (t) => t.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\\u2014\\u2015\]/g, '')
ck('no em dash in what these say to a person', !DASH.test(strip(fs.readFileSync(`${FN}/_shared/caregiver-card-link.ts`, 'utf8'))) && !DASH.test(strip(cardSrc)) && !DASH.test(strip(fct)) && !DASH.test(strip(intro)))

// ── 4. caregiver-profile: an older profile stays open to its owner while it is checked ──
const CP = await load(`${FN}/caregiver-profile/index.ts`, [[/^import \{ createClient \} from .*$/m, 'const createClient = () => ({})'],
  [/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES = []; const requireStaff = async () => ({})']])
ck('a published profile locks the personal link; an older moved profile (needs_review) does not', CP.locked({ published: true }) && !CP.locked({ published: true, needs_review: true }) && !CP.locked({ published: false }))
const cps = fs.readFileSync(`${FN}/caregiver-profile/index.ts`, 'utf8')
ck('publishing clears needs_review (the full checks passed), and the locks use locked()', /needs_review: false, published_at: now/.test(cps)
  && /if \(locked\(p\)\) return json\(\{ error: PUBLISHED_NOTE/.test(cps) && /if \(locked\(p\)\) return json\(\{ error: 'Their profile is published/.test(cps) && /published: locked\(p\)/.test(cps))

// ── 5. the migration SQL ──
const sq = fs.readFileSync('caregiver_profile_2b.sql', 'utf8'), code = sq.replace(/--.*$/gm, '')
ck('SQL: new columns and the unique legacy index are add-if-missing', ['photo_url', 'legacy_intro_id', 'needs_review'].every((c) => code.includes('add column if not exists ' + c))
  && /create unique index if not exists caregiver_profiles_legacy_intro_uniq\s+on public\.caregiver_profiles \(legacy_intro_id\) where legacy_intro_id is not null/.test(code))
ck('SQL idempotent: the insert skips any intro already moved; every update only touches rows not handled yet',
  /insert into public\.caregiver_profiles[\s\S]*not exists \(select 1 from public\.caregiver_profiles x where x\.legacy_intro_id = i\.id::text\)/.test(code)
  && /set legacy_intro_id = u\.intro_id[\s\S]*p\.legacy_intro_id is null/.test(code) && /set axiscare_id = t\.ax[\s\S]*p\.axiscare_id is null/.test(code))
ck('SQL: moved intros are published, approved, consent false and flagged needs_review; a withdrawn or duplicate person is never created',
  /i\.id::text, true, 'approved', false, true/.test(code) && /p\.status <> 'withdrawn'\s+-*/.test(sq) && /having count\(distinct pid\) = 1/.test(code)
  && /and not exists \(\s*select 1 from public\.caregiver_profiles p\s+where coalesce\(btrim\(p\.last_name\), ''\) <> ''/.test(code))
ck('SQL: the AxisCare id is filled only when one roster entry has that name and nobody else holds the id',
  /having count\(distinct ax\) = 1/.test(code) && /o\.axiscare_id = t\.ax and o\.id <> p\.id and o\.status <> 'withdrawn'/.test(code))
ck('SQL: one transaction is left to the installer, and nothing is dropped, deleted or granted',
  !/\b(begin|commit|rollback)\s*;/i.test(code) && !/\b(drop|delete|truncate|grant|revoke)\b/i.test(code))
ck('SQL: an em dash in an older intro is turned into a comma; no em dash typed in the file', /'\\s\*\[\\u2014\\u2015\]\\s\*', ', '/.test(code) && !DASH.test(sq))

// ── 6. optional: the SQL for real, twice, in an embedded Postgres ──
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  await db.exec(`
create table caregiver_profiles (id uuid primary key default gen_random_uuid(), first_name text not null, preferred_name text, axiscare_id text, last_name text,
 photo_path text, about text, consent boolean not null default false, published boolean not null default false, status text not null default 'new',
 published_at timestamptz, published_by text, updated_at timestamptz not null default now());
create table caregiver_intros (id uuid primary key, name text, intro text, about text, photo_url text);
create table app_data (key text primary key, data jsonb not null default '[]');
insert into caregiver_intros values ('${U(1)}','Sarah  Thompson','Kind \u2014 calm.',null,'https://x/s.jpg'), ('${U(2)}','Maria Lopez','m',null,null), ('${U(3)}','Wd Gone','w',null,null),
 ('${U(4)}','Two Same','t',null,null), ('${U(5)}','   ',null,null,null), ('${U(6)}','Kim Ray','k',null,null);
insert into caregiver_profiles (first_name,last_name,status) values ('Maria','Lopez','new'),('Wd','Gone','withdrawn'),('Two','Same','new'),('Two','Same','approved');
insert into app_data values ('caregivers','[{"first":"Sarah","last":"Thompson","axiscare_id":"501"},{"first":"Kim","last":"Ray","axiscare_id":"601"},{"first":"Kim","last":"Ray","axiscare_id":"602"}]');`)
  await db.exec('begin;\n' + sq + '\ncommit;')
  const snap = async () => (await db.query('select first_name, last_name, about, photo_url, legacy_intro_id, published, status, consent, needs_review, axiscare_id from caregiver_profiles order by first_name, last_name')).rows
  const a = await snap(); await db.exec('begin;\n' + sq + '\ncommit;'); const b = await snap()
  const by = (f, l) => a.filter((x) => x.first_name === f && x.last_name === l)
  ck('PGLITE: Sarah moved: published, needs_review, consent false, em dash gone, photo kept, AxisCare id from the one roster match',
    by('Sarah', 'Thompson').length === 1 && by('Sarah', 'Thompson')[0].published && by('Sarah', 'Thompson')[0].needs_review && !by('Sarah', 'Thompson')[0].consent
    && by('Sarah', 'Thompson')[0].about === 'Kind, calm.' && by('Sarah', 'Thompson')[0].photo_url === 'https://x/s.jpg' && by('Sarah', 'Thompson')[0].axiscare_id === '501', a)
  ck('PGLITE: Maria already had a profile: only linked, no duplicate, not published', by('Maria', 'Lopez').length === 1 && by('Maria', 'Lopez')[0].legacy_intro_id === U(2) && !by('Maria', 'Lopez')[0].published, a)
  ck('PGLITE: withdrawn, two-profile and blank names create nothing; two roster ids leave the AxisCare id empty',
    by('Wd', 'Gone').length === 1 && by('Two', 'Same').length === 2 && a.length === 6 && by('Kim', 'Ray')[0].axiscare_id === null, a)
  ck('PGLITE: running it again changes nothing', JSON.stringify(a) === JSON.stringify(b), [a.length, b.length])
} else console.log('(PGLITE not set: the real-Postgres run of the SQL is skipped)')

// ── 7. the Hub (cc-hub-live) ──
const HUB = process.env.HUB || path.resolve('..', 'cc-hub-live')
if (fs.existsSync(path.join(HUB, 'index.html'))) {
  const idx = fs.readFileSync(path.join(HUB, 'index.html'), 'utf8'), pan = fs.readFileSync(path.join(HUB, 'caregiver-profile-panel.js'), 'utf8')
  const card = fs.readFileSync(path.join(HUB, 'caregiver.html'), 'utf8'), meet = fs.readFileSync(path.join(HUB, 'meet.html'), 'utf8')
  ck('Hub: nothing reads caregiver_intros or links meet.html any more; the orphaned cgp* code is gone',
    !/caregiver_intros|FC_INTROS/.test(idx) && !/meet\.html/.test(idx) && !/function cgp[A-Z]/.test(idx) && !/CGPROFILES|CGP_CIRCLES/.test(idx))
  ck('Hub Circles: the change picker lists published, not withdrawn profiles as "First L." and links caregiver.html?id=',
    /from\('caregiver_profiles'\)\.select\('id,first_name,last_name,preferred_name,photo_path,photo_url,published,status'\)\.eq\('published',true\)\.neq\('status','withdrawn'\)/.test(idx)
    && /fcCardName\(g\)/.test(idx) && /' Meet ' \+ \(whoFirst\|\|'them'\) \+ ' here: https:\/\/cc\.mo-care\.com\/caregiver\.html\?id=' \+ encodeURIComponent\(g\.id\)/.test(idx)
    && /No published profile picked, so no link\./.test(idx))
  ck('Hub panel: "Introduce to a family" only on a published profile, preview first, a confirm before sending, failures shown',
    /\(row\.published \? btn\('intro'/.test(pan) && /introBody\(m, true\), 'caregiver-intro'/.test(pan) && /if \(!pv \|\| !pv\.would_reach \|\| !pv\.would_reach\.length\) return;/.test(pan)
    && /if \(!confirm\('Send ' \+ cardName\(row\)/.test(pan) && /NOT sent to ' \+ sr\.failed\.join/.test(pan) && /filter\(function \(x\) \{ return x\.axiscare_client_id; \}\)/.test(pan))
  ck('Hub panel: older profiles say "check the words, add a proper photo and get their OK"; their old photo shows until replaced',
    /Older profile: check the words, add a proper photo and get their OK\./.test(pan) && /photo_url,needs_review,legacy_intro_id/.test(pan) && /function photoOf\(row\)/.test(pan))
  ck('card page: "Your caregiver from Caring Companions", the three headings by first name, works-for line, big call button, no pronoun',
    /Your caregiver from Caring Companions/.test(card) && /'A little about ' \+ F/.test(card) && /F \+ '(\\u2019|\u2019)s experience caring for others'/.test(card)
    && /'Why ' \+ F \+ ' loves caregiving'/.test(card) && /' works for Caring Companions<\/b>, and is background checked and trained/.test(card)
    && /class="call" href="' \+ OFFICE_TEL/.test(card) && /font-size:19px/.test(card) && /@media print/.test(card) && !/\b(he|she|his|her)\b/i.test(card.slice(card.indexOf('<script>'))))
  ck('card and Hub copy have no em dash', !DASH.test(card) && !DASH.test(strip(pan)) && !DASH.test(meet.slice(meet.indexOf('<script>'))))
  ck('meet.html: an old link forwards to the moved card (caregiver-card ?legacy=), else shows what it always did',
    /CARD\+'\?legacy='\+encodeURIComponent\(cg\)/.test(meet) && /location\.replace\('caregiver\.html\?id='/.test(meet) && /meet-caregiver/.test(meet))
} else console.log('(Hub folder not found: Hub scans skipped)')

let all = true; console.log('\nCAREGIVER PROFILE 2b · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED'); if (!all) process.exitCode = 1
