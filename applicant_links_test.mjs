// 444 · private applicant links: _shared/applicant-links.ts and the applicant-link service (with a fake database and a
// fake Training Platform), plus the start form check honouring a private link. node applicant_links_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 600)])
const SECRET = 'x'.repeat(40)
globalThis.Deno = { env: { get: (k) => ({ HUB_JOB_SECRET: SECRET, OFFERS_PROJECT_URL: 'https://train.test', OFFERS_SERVICE_ROLE_KEY: 'svc', SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' })[k] ?? '' }, serve: (h) => { globalThis.__h = h } }
const L = await import(path.join(FN, '_shared/applicant-links.ts'))
const now = Math.floor(Date.now() / 1000)
const OFFER = 'b3f0c2aa-1111-4222-8333-444455556666'
let url = await L.makeStartLink(SECRET, OFFER)
const q = new URL(url).searchParams
ck('a start link carries only the offer number, an expiry and a code: no name, phone or email', /^https:\/\/cc\.mo-care\.com\/start\.html\?o=[0-9a-f-]+&e=\d+&t=[A-Za-z0-9_-]{43}$/.test(url) && !/first|last|phone|email|@/.test(url), url)
ck('...it runs out after 30 days', Number(q.get('e')) - now >= 30 * 86400 - 5 && Number(q.get('e')) - now <= 30 * 86400 + 5)
ck('...and the server accepts it', await L.checkLink(SECRET, 'start', q.get('o'), q.get('e'), q.get('t')))
ck('an altered offer number is refused', !(await L.checkLink(SECRET, 'start', 'b3f0c2aa-1111-4222-8333-444455556667', q.get('e'), q.get('t'))))
ck('a later expiry typed in is refused', !(await L.checkLink(SECRET, 'start', q.get('o'), Number(q.get('e')) + 86400, q.get('t'))))
ck('an expired link is refused', !(await L.checkLink(SECRET, 'start', q.get('o'), q.get('e'), q.get('t'), Number(q.get('e')) + 1)))
ck('a start code never opens an orientation link (or the other way round)', !(await L.checkLink(SECRET, 'orient', q.get('o'), q.get('e'), q.get('t'))))
ck('without the server secret nothing checks out', !(await L.checkLink('', 'start', q.get('o'), q.get('e'), q.get('t'))) && !(await L.checkLink('y'.repeat(40), 'start', q.get('o'), q.get('e'), q.get('t'))))
const ou = await L.makeOrientLink(SECRET, '17', 'W3siaWQiOjF9XQ==')
const oq = new URL(ou).searchParams
ck('an orientation link: the open sessions, the candidate number and a code, nothing personal', /^https:\/\/sc\.mo-care\.com\/orientation-booking\.html\?sessions=/.test(ou) && oq.get('c') === '17' && oq.get('sessions') === 'W3siaWQiOjF9XQ==' && !/first|phone|email/.test(ou) && await L.checkLink(SECRET, 'orient', '17', oq.get('e'), oq.get('t')), ou)

/* the service */
const src = fs.readFileSync(path.join(FN, 'applicant-link/index.ts'), 'utf8')
  .replace(/^import \{ createClient \}.*$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__db;')
  .replace(/^import \{ requireStaff, OFFICE_ROLES \}.*$/m, "const OFFICE_ROLES = ['x']; const requireStaff = async (_d: any, req: Request) => req.headers.get('Authorization') === 'Bearer staff' ? { ok: true, name: 'Kat', email: 'k@x' } : { ok: false, status: 401, error: 'Sign in first.' };")
  .replace("'../_shared/applicant-links.ts'", "'" + path.join(FN, '_shared/applicant-links.ts') + "'")
const tmp = path.join(os.tmpdir(), 'applicant_link_test_' + process.pid + '.ts'); fs.writeFileSync(tmp, src); await import(tmp); fs.unlinkSync(tmp)
const T = { inserted: [], cands: [{ id: 17, first: 'Ava', last: 'Applicant', phone: '4175550199', email: 'ava@x.com', office: 'springfield' }], sessions: [{ id: 's1', date: '2026-10-10' }] }
globalThis.__db = { from: (t) => { const b = { select() { return b }, eq(k, v) { b.k = v; return b },
  async maybeSingle() { return { data: { data: b.k === 'candidates' ? T.cands : b.k === 'orient_sessions' ? T.sessions : [] }, error: null } },
  async insert(r) { T.inserted.push(...r); return { error: null } } }; return b } }
const offers = { [OFFER]: { id: OFFER, first_name: 'Ben', last_name: 'B', phone: '4175550111', email: 'ben@x.com' } }
globalThis.fetch = async (u) => { const m = String(u).match(/id=eq\.([^&]+)/); const o = m && offers[decodeURIComponent(m[1])]; return new Response(JSON.stringify(o ? [o] : []), { status: 200 }) }
const call = async (body, auth) => { const r = await globalThis.__h(new Request('http://x', { method: 'POST', headers: auth ? { Authorization: 'Bearer ' + auth } : {}, body: JSON.stringify(body) })); return [r.status, await r.json()] }
let [s, j] = await call({ action: 'mint', kind: 'start', offer_id: OFFER })
ck('making a link needs an office sign-in', s === 401 && !j.url)
;[s, j] = await call({ action: 'mint', kind: 'start', offer_id: OFFER }, 'staff')
ck('an office person gets a private start link', s === 200 && /\?o=b3f0c2aa/.test(j.url), j)
const sq = new URL(j.url).searchParams
;[s, j] = await call({ action: 'open', kind: 'start', o: sq.get('o'), e: sq.get('e'), t: sq.get('t') })
ck('the start page, with the link: who it is for (her decision 1: fill in what we know)', s === 200 && j.first === 'Ben' && j.phone === '4175550111' && j.email === 'ben@x.com', j)
;[s, j] = await call({ action: 'open', kind: 'start', o: sq.get('o'), e: sq.get('e'), t: 'B'.repeat(43) })
ck('a made-up code gets nothing about anyone', s === 401 && !j.first && /not valid or has run out/.test(j.error), j)
;[s, j] = await call({ action: 'mint', kind: 'orient', candidate_id: '17', sessions: 'W3siaWQiOiJzMSJ9XQ==' }, 'staff')
const ok2 = new URL(j.url).searchParams
;[s, j] = await call({ action: 'open', kind: 'orient', c: ok2.get('c'), e: ok2.get('e'), t: ok2.get('t') })
ck('the orientation page, with the link: the candidate', s === 200 && j.first === 'Ava' && j.candidate_id === '17', j)
;[s, j] = await call({ action: 'book', session_id: 's1', c: ok2.get('c'), e: ok2.get('e'), t: ok2.get('t') })
ck('booking with the link: saved by the server under that candidate (name, phone, number from the Hub)', s === 200 && T.inserted.at(-1).candidate_id === '17' && T.inserted.at(-1).first === 'Ava' && T.inserted.at(-1).phone === '4175550199', T.inserted)
;[s, j] = await call({ action: 'book', session_id: 's1', c: '18', e: ok2.get('e'), t: ok2.get('t') })
ck('a link edited to another candidate can\'t book in their name', s === 401 && T.inserted.length === 1)
;[s, j] = await call({ action: 'book', session_id: 's1' })
ck('the office\'s all-sessions link (no person): saved as before, under "Unknown"', s === 200 && T.inserted.at(-1).first === 'Unknown' && T.inserted.at(-1).candidate_id === null)
;[s, j] = await call({ action: 'book', session_id: 'nope' })
ck('a session that is not open: refused with the office number', s === 404 && /\(417\) 234-8494/.test(j.error))
ck('it answers the public pages (CORS on every answer, OPTIONS)', /req\.method === 'OPTIONS'/.test(src) && /Access-Control-Allow-Origin/.test(src))

/* the start form check: a form from a valid private link counts as "we sent them a start link" */
const J = await import(path.join(FN, '_shared/intake-import.ts'))
ck('the check reads the link columns (never the SSN)', /start_offer_id, start_link_exp, start_link_sig/.test(J.INTAKE_COLS) && !/ssn/.test(J.INTAKE_COLS))
const IX = fs.readFileSync(path.join(FN, 'intake-import/index.ts'), 'utf8')
ck('...and checks the code itself, against when the form was sent', /checkLink\(Deno\.env\.get\('HUB_JOB_SECRET'\) \?\? '', 'start', f\.start_offer_id, f\.start_link_exp, f\.start_link_sig, Math\.floor\(Date\.parse\(f\.created_at\) \/ 1000\)/.test(IX))
ck('no em dash', !/—/.test(src + fs.readFileSync(path.join(FN, '_shared/applicant-links.ts'), 'utf8')))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
