// caregiver-availability (the My Hours page's server), 2026-10-14: the "also text me about open shifts outside these times"
// box is read back for the page, saved with the hours, and kept when an older page saves without it. Fake database.
// node caregiver_availability_outside_ok_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const DB = { caregivers: [{ id: 7, first: 'Ann', last: 'Aide', phone: '(417) 555-0107', axiscare_id: 77, active: true }], caregiver_availability: [] }
globalThis.__DB = DB
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cao_'))
try {
  fs.writeFileSync(path.join(tmp, 'fake-sb.mjs'), `export const createClient = () => ({
    from: () => ({ select: () => ({ eq: (c, k) => ({ maybeSingle: async () => ({ data: k in globalThis.__DB ? { data: globalThis.__DB[k] } : null }) }) }) }),
    rpc: async (fn, a) => { const arr = globalThis.__DB[a.target_key] ||= []; const i = arr.findIndex((x) => String(x.id) === String(a.item.id)); if (i >= 0) arr[i] = a.item; else arr.push(a.item); return { error: null } } })`)
  const src = fs.readFileSync(path.join(F, 'caregiver-availability/index.ts'), 'utf8')
    .replace("from 'https://esm.sh/@supabase/supabase-js@2'", "from '" + path.join(tmp, 'fake-sb.mjs') + "'")
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'ca.ts'), src); await import(path.join(tmp, 'ca.ts'))
  const call = async (body) => { const r = await handler(new Request('https://x/functions/v1/caregiver-availability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
  const wins = { mon: ['morning'], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
  let r = await call({ phone: '417-555-0107' })
  ck('nothing on file: the box reads as not set', r.j.first_name === 'Ann' && r.j.outside_ok === null, r.j)
  r = await call({ phone: '417-555-0107', action: 'save', target_hours: 25, windows: wins, outside_ok: true })
  ck('saved with the box ticked', r.j.saved === true && DB.caregiver_availability[0].outside_ok === true && DB.caregiver_availability[0].target_hours === 25, DB.caregiver_availability)
  r = await call({ phone: '417-555-0107' })
  ck('read back ticked for the page', r.j.outside_ok === true, r.j)
  r = await call({ phone: '417-555-0107', action: 'save', target_hours: 25, windows: wins })
  ck('an older page that never sends the box keeps what is on file', DB.caregiver_availability[0].outside_ok === true, DB.caregiver_availability)
  r = await call({ phone: '417-555-0107', action: 'save', target_hours: 25, windows: wins, outside_ok: false })
  ck('unticked is saved as no', DB.caregiver_availability[0].outside_ok === false, DB.caregiver_availability)
  DB.caregiver_availability[0].step1 = { hours_min: 20 }
  r = await call({ phone: '417-555-0107', action: 'save', target_hours: 30, windows: wins, outside_ok: true })
  ck('a save keeps the rest of the record (their Step 1 details)', DB.caregiver_availability[0].step1?.hours_min === 20 && DB.caregiver_availability[0].source === 'self', DB.caregiver_availability)
  r = await call({ phone: '417-555-0107', action: 'confirm' })
  ck('"Still right" keeps the box', r.j.confirmed === true && DB.caregiver_availability[0].outside_ok === true, DB.caregiver_availability)
  const inv = fs.readFileSync(path.join(F, 'caregiver-availability/index.ts'), 'utf8')
  ck('the invite text mentions the outside-hours choice, no em dash', /You can also tell us if you'd like texts about shifts outside those hours\./.test(inv) && !/—/.test(inv.match(/`Hi \{first_name\}[^`]*`/)[0]))
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
