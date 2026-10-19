// staffing-route (Samantha 2026-10-14): staffing calls to the Staffing Coordinator. Under Node against the REAL function and
// _shared/staffing-route.ts with a stand-in database and GoHighLevel.
//   node staffing_route_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
const F = 'supabase/functions', SERVICE = 'service'.repeat(6)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, GHL_TOKEN: 'ghl-tok', GHL_LOCATION_ID: 'loc1', HUB_JOB_SECRET: 'j'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_sr_'))
const rewrite = (src) => src.replace(/^import \{ createClient \} from ['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2['"];?$/m, 'const createClient = globalThis.__fakeCreateClient;')
fs.mkdirSync(path.join(tmp, '_shared'))
for (const f of fs.readdirSync(path.join(F, '_shared'))) fs.writeFileSync(path.join(tmp, '_shared', f), rewrite(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
fs.mkdirSync(path.join(tmp, 'staffing-route')); fs.writeFileSync(path.join(tmp, 'staffing-route', 'index.ts'), rewrite(fs.readFileSync(path.join(F, 'staffing-route', 'index.ts'), 'utf8')))

const nowDow = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short' })
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(nowDow)
let DB, GH
function reset(o = {}) {
  DB = {
    app_data: [{ key: 'ops_settings', data: { staffing_route_live: false, ...(o.settings || {}) } },
      { key: 'duty_windows', data: o.windows || [] }, { key: 'positions', data: [] },
      { key: 'caregivers', data: [{ phone: '(417) 555-0001', first: 'Cara' }] }],
    job_applicants: [{ phone: '417-555-0002', first_name: 'Ann' }, { phone: '417-555-0009', first_name: 'New' }], hire_intake: [{ phone: '+14175550003' }],
    identity_scan_cache: [
      { ghl_contact_id: 'c1', first_name: 'Cara', last_name: 'G', phone: '+14175550001', tags: [] },                       // Hub caregiver, no tag yet
      { ghl_contact_id: 'c2', first_name: 'Old', last_name: 'Applicant', phone: '+14175550100', tags: ['Inactive Applicant'] },
      { ghl_contact_id: 'c3', first_name: 'Fran', last_name: 'Family', phone: '+14175550200', tags: ['inactive employee', 'Inactive Client'] }, // both: office
      { ghl_contact_id: 'c4', first_name: 'Mary', last_name: 'Lead', phone: '+14175550300', tags: ['lead'] },
      { ghl_contact_id: 'c5', first_name: 'Done', last_name: 'D', phone: '+14175550400', tags: ['staffing-caller'] },
      { ghl_contact_id: 'c6', first_name: 'Gone', last_name: 'G', phone: '+14175550500', tags: ['applied'] }],
    writes: [], beats: [],
  }
  GH = { calls: [], cv: o.cv === undefined ? [{ id: 'cv1', name: 'Staffing Coordinator on duty', value: 'no' }] : o.cv, cvStatus: o.cvStatus || 200,
    dup: { '+14175550002': { id: 'c7', tags: [] }, '+14175550003': { id: 'c8', tags: ['client'] } } }
}
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async () => ({ data: null, error: { message: 'no' } }) },
  rpc: async (fn, a) => { DB.writes.push(a.target_key); if (a.target_key === 'automation_heartbeats') DB.beats.push(a.item); else { let r = DB.app_data.find((x) => x.key === a.target_key); if (!r) DB.app_data.push(r = { key: a.target_key, data: [] }); r.data.push(a.item) } return { data: null, error: null } },
  from: (tb) => { const f = []; let single = false, rng = null
    const p = { select() { return p }, eq(k, v) { f.push((r) => String(r[k]) === String(v)); return p }, in(k, v) { f.push((r) => v.includes(r[k])); return p }, maybeSingle() { single = true; return p }, range(a, b) { rng = [a, b]; return p },
      insert() { DB.writes.push(tb); return Promise.resolve({ error: null }) },
      then(ok, bad) { let rows = (DB[tb] || []).filter((r) => f.every((fn) => fn(r))); if (rng) rows = rows.slice(rng[0], rng[1] + 1); return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad) } }
    return p },
})
globalThis.fetch = async (url, o) => { url = String(url); const m = (o && o.method) || 'GET'; GH.calls.push(m + ' ' + url); let x
  if (url.endsWith('/locations/loc1/customValues') && m === 'GET') return new Response(JSON.stringify({ customValues: GH.cv }), { status: GH.cvStatus })
  if ((x = url.match(/customValues\/([^/]+)$/)) && m === 'PUT') { const c = GH.cv.find((v) => v.id === x[1]); c.value = JSON.parse(o.body).value; return new Response('{}', { status: 200 }) }
  if ((x = url.match(/number=([^&]+)$/))) { const c = GH.dup[decodeURIComponent(x[1])]; return new Response(JSON.stringify(c ? { contact: c } : {}), { status: 200 }) }
  if ((x = url.match(/contacts\/([^/]+)\/tags$/)) && m === 'POST') return new Response('{}', { status: x[1] === 'c6' ? 404 : 200 })
  return new Response('{}', { status: 404 }) }
const run = async (q = '') => { const r = await handler(new Request('https://x.supabase.co/functions/v1/staffing-route' + q, { method: 'POST', headers: { Authorization: 'Bearer ' + SERVICE } })); return [r.status, await r.json()] }
const onWin = (person) => [{ area: 'staffing', person, recur: { days: [DOW], from: '00:00', to: '23:59' } }]

try {
  const lib = await import(path.join(tmp, '_shared', 'staffing-route.ts'))
  const t = lib.tagsOf({})
  ck('decide: an old applicant tag is staff; a Hub caregiver with no tag is staff; a lead is not', lib.decide(['Inactive Applicant'], false, t) === 'add' && lib.decide([], true, t) === 'add' && lib.decide(['lead'], false, t) === 'not_staff')
  ck('decide: staff who are also a client, family member or lead go to the office (blocked); already tagged is left alone', lib.decide(['inactive employee', 'inactive client'], false, t) === 'blocked' && lib.decide([], true, new Set()) !== 'x' && lib.decide(['staffing-caller'], false, t) === 'has')
  ck('tag lists are Hub-editable (ops_settings)', lib.tagsOf({ staffing_route_tags: ['Worker'] }).staff.has('worker') && !lib.tagsOf({ staffing_route_tags: ['Worker'] }).staff.has('applicant'))
  ck('on duty: only while staffing@mo-care.com holds a SCHEDULED Staffing window; the "nobody scheduled" fallback never counts', lib.coordinatorOnDuty(onWin('staffing@mo-care.com'), {}, new Date()).on === true
    && lib.coordinatorOnDuty(onWin('krystal@mo-care.com'), {}, new Date()).on === false && lib.coordinatorOnDuty([], { duty_default_staffing: 'staffing@mo-care.com' }, new Date()).on === false)

  reset(); await import(path.join(tmp, 'staffing-route', 'index.ts')); const h = handler
  let [s, j] = await (async () => { const r = await h(new Request('https://x.supabase.co/functions/v1/staffing-route', { method: 'POST' })); return [r.status, await r.json()] })()
  ck('no key: refused', s === 401, [s, j])
  reset({ windows: onWin('staffing@mo-care.com') }); [s, j] = await run()
  ck('LOOK ONLY (switch off): reports on duty yes and the change it would make; writes nothing to GoHighLevel', s === 200 && j.live === false && j.duty.on_duty === 'yes' && j.duty.would_change === 'no -> yes' && GH.cv[0].value === 'no'
    && GH.calls.every((c) => c.startsWith('GET ')), [j, GH.calls])
  ck('LOOK ONLY: who it would tag: the old applicant, the Hub caregiver, the gone contact and the Hub applicant found by phone (4); the employee who is also a client and the Hub new hire who is a client are blocked; the lead untouched; the tagged one counted as done',
    j.tags.would_add === 4 && j.tags.blocked === 2 && j.tags.already === 1 && j.tags.added === 0 && j.tags.hub_people === 4 && j.tags.hub_not_in_ghl === 1 && !DB.writes.includes('staffing_route_tagged'), j.tags)
  reset({ windows: onWin('krystal@mo-care.com'), settings: { staffing_route_live: true } }); GH.cv[0].value = 'yes'; [s, j] = await run('?part=duty')
  ck('LIVE duty: Krystal on the seat, so the value goes back to no (calls to the office)', j.duty.on_duty === 'no' && j.duty.changed === true && GH.cv[0].value === 'no' && !j.tags, j)
  reset({ windows: onWin('staffing@mo-care.com'), settings: { staffing_route_live: true } }); [s, j] = await run('?part=duty')
  ck('LIVE duty: staffing@ on the seat: yes; the next run changes nothing', j.duty.changed === true && GH.cv[0].value === 'yes' && (await run('?part=duty'))[1].duty.changed === false)
  reset({ settings: { staffing_route_live: true }, cv: [] }); [s, j] = await run('?part=duty')
  ck('no custom value yet: says how to create it, and the heartbeat fails (never quiet)', /create it in GoHighLevel/.test(j.duty.error) && DB.beats.at(-1).ok === false, j)
  reset({ settings: { staffing_route_live: true }, cvStatus: 403 }); [s, j] = await run('?part=duty')
  ck('GoHighLevel refuses custom values: says the key may need the permission', /custom values permission/.test(j.duty.error), j)
  reset({ settings: { staffing_route_live: true } }); [s, j] = await run('?part=tags')
  const posts = GH.calls.filter((c) => c.startsWith('POST '))
  ck('LIVE tags: adds the tag to the 4 (a contact gone from GoHighLevel is counted, not an error) and remembers each tagged one', j.tags.added === 3 && j.tags.gone === 1 && j.tags.errors === 0 && posts.length === 4
    && DB.app_data.find((x) => x.key === 'staffing_route_tagged').data.length === 4, [j.tags, posts])
  ck('LIVE tags: never a client, family member or lead; never removes a tag; never creates a contact; never sends', !posts.some((c) => /c3|c4|c5|c8/.test(c)) && !GH.calls.some((c) => /DELETE|\/contacts\/upsert|POST .*\/contacts\/?$|messages/.test(c)))
  ;[s, j] = await run('?part=tags')
  ck('LIVE tags: the next run does not tag the same people again', j.tags.would_add === 0 && j.tags.added === 0 && !j.tags.gone, j.tags)
  const src = fs.readFileSync(path.join(F, 'staffing-route', 'index.ts'), 'utf8')
  ck('no em dash in the job or its rules', !/[—]/.test(src + fs.readFileSync(path.join(F, '_shared', 'staffing-route.ts'), 'utf8')))
} catch (e) { res.push(['crashed: ' + (e.stack || e), false, '']) } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const failed = res.filter((r) => !r[1]); console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? ' · FAIL' : ''}`)
process.exit(failed.length ? 1 : 0)
