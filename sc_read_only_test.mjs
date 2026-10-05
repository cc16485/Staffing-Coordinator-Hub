// Safe saves step 3 (2026-10-04): sc.mo-care.com is read only. The real block from index.html, run against a fake
// Supabase client and fetch. node sc_read_only_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'
const ROOT = path.dirname(new URL(import.meta.url).pathname)
/* the staff page was retired 2026-10-04 (now a short "moved" page); this checks its last full version, and below, the moved page */
const html = (await import('child_process')).execSync('git show 7b3243acfab29714f9a124a02720fcf63425134a:index.html', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 })
const MOVED = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 500)])
const a = html.indexOf('// ── READ ONLY (safe saves step 3'), b = html.indexOf('// ── Admin passcode', a)
const block = html.slice(a, b)
const sent = [], fetched = [], notices = []
const builder = (t) => { const q = { t }; for (const m of ['select', 'eq', 'in', 'order', 'limit', 'single', 'maybeSingle']) q[m] = () => q
  for (const m of ['insert', 'update', 'upsert', 'delete']) q[m] = () => { sent.push([t, m]); return q }
  q.then = (ok, ko) => Promise.resolve({ data: [{ key: 'x' }], error: null }).then(ok, ko); return q }
const body = { children: [], prepend(x) { this.children.unshift(x) } }
const ctx = { console, JSON, Promise, String, Proxy, Response: class { constructor(b, o) { this.status = o.status; this.b = b } async json() { return JSON.parse(this.b) } },
  sb: { rpc: () => { sent.push(['rpc']); return Promise.resolve({ data: 1, error: null }) }, from: builder, functions: { invoke: () => { sent.push(['invoke']); return Promise.resolve({}) } } },
  window: { fetch: async (u) => { fetched.push(String(u)); return { status: 200, json: async () => ({ ok: true }) } } },
  document: { readyState: 'complete', body, getElementById: (id) => body.children.find((c) => c.id === id) || null, createElement: () => ({ style: {}, setAttribute() {} }), addEventListener() {} },
  scReadOnlyNotice: () => notices.push(1) }
vm.createContext(ctx)
vm.runInContext(block + '\nthis.__fetch = window.fetch;', ctx)
const FN = 'https://zngsgedlsxinbygwmxwn.supabase.co/functions/v1/', TR = 'https://rdqujxiycycwhskyvrwa.supabase.co/functions/v1/'
let r = await ctx.sb.rpc('upsert_app_data_item', { target_key: 'client_queue', item: {} })
ck('a save (upsert_app_data_item) is refused with the message, never sent', r.error && /read only now/.test(r.error.message) && !sent.length && notices.length === 1, [r, sent])
r = await ctx.sb.rpc('delete_app_data_item', {}); ck('a delete is refused', r.error && !sent.length)
r = await ctx.sb.from('client_queue').update({ status: 'done' }).eq('id', 1)
ck('a table update (client_queue) is refused, never sent', r.error && !sent.length, sent)
r = await ctx.sb.from('client_queue').insert({}).select().single()
ck('an insert, even chained, is refused', r.error && !sent.length)
for (const t of ['evv_submissions', 'orient_bookings', 'app_data']) { r = await ctx.sb.from(t).upsert({}); if (!r.error) ck('refused ' + t, false) }
ck('every table it wrote (evv_submissions, orient_bookings, app_data) is refused', !sent.length, sent)
r = await ctx.sb.from('app_data').select('*')
ck('reading still works', Array.isArray(r.data) && !r.error)
r = await ctx.sb.functions.invoke('send-candidate-message', { body: {} })
ck('the candidate text (send-candidate-message) is refused', r.error && !sent.length)
for (const f of ['ghl-reply', 'job-offer']) { const x = await ctx.__fetch(TR + f, { method: 'POST' }); if (x.status !== 403) ck('refused ' + f, false) }
for (const f of ['axiscare-note', 'axiscare-push-note']) { const x = await ctx.__fetch(FN + f, { method: 'POST' }); if (x.status !== 403) ck('refused ' + f, false) }
ck('texts, offers and AxisCare notes are refused before they leave the browser', !fetched.length, fetched)
for (const f of ['ghl-thread', 'ghl-replies', 'axiscare-open-shifts', 'hub-training-data?action=training_status']) await ctx.__fetch(TR + f, { method: 'POST' })
await ctx.__fetch(FN + 'coverage-shifts', { method: 'POST' })
ck('reads still go through (conversations, replies, open shifts, training status, coverage shifts)', fetched.length === 5, fetched)
ck('the read-only banner is at the top of the page with the link', body.children[0] && body.children[0].id === 'sc-ro-top' && /no longer saves or sends anything/.test(body.children[0].innerHTML) && /cc\.mo-care\.com/.test(body.children[0].innerHTML))
ck('the page creates no other Supabase client that could get round it', (html.match(/createClient\(/g) || []).length === 1)
ck('every server call the page makes is either refused or a read', [...html.matchAll(/functions\/v1\/([a-z0-9-]+)/g)].map((m) => m[1]).every((n) => ['axiscare-note', 'axiscare-push-note', 'ghl-reply', 'job-offer', 'axiscare-open-shifts', 'coverage-shifts', 'ghl-replies', 'ghl-thread', 'hub-training-data'].includes(n)))
ck('no em dash in the block', !/—/.test(block))
ck('the retired page that replaced it (2026-10-04) has no Supabase, no form and no script: it only points to the Care Coordinator Hub', !/supabase|createClient|<script|<form|<input/i.test(MOVED) && /https:\/\/cc\.mo-care\.com\/#cgbackground/.test(MOVED))
ck('the public pages texts link to are still here', ['evv-correction-form.html', 'evv-client-sign.html', 'orientation-booking.html'].every((f) => fs.existsSync(path.join(ROOT, f))))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
