// batch2_routing_test.mjs · server jobs off Samantha, batch 2 (Samantha 2026-10-18, built switched off): the shared
// routingBySettings / escalationTo in _shared/notice-to.ts against a fake database, and the four jobs' fallbacks read
// from their source (off = Samantha by name exactly as before; on = noticeTo / escalationTo). node batch2_routing_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_b2_'))
let DB
const q = (t) => { const f = []; const b = { select() { return b }, eq(c, v) { f.push([c, v]); return b },
  maybeSingle: async () => { const rows = (DB[t] || []).filter((r) => f.every(([c, v]) => r[c] === v)); return { data: rows[0] ?? null, error: null } },
  then(ok) { return Promise.resolve({ data: (DB[t] || []).filter((r) => f.every(([c, v]) => r[c] === v)), error: null }).then(ok) } }; return b }
const db = { from: q }
try {
  fs.copyFileSync(path.join(F, '_shared/notice-to.ts'), path.join(tmp, 'notice-to.ts'))
  const N = await import(path.join(tmp, 'notice-to.ts'))
  const base = (live, esc, lead) => ({
    app_data: [{ key: 'ops_settings', data: live === undefined ? {} : { routing_by_settings_live: live } }],
    persons: [{ person_id: 'k', primary_email: 'krystal@mo-care.com', full_name: 'Krystal Land', active: true }, { person_id: 'z', primary_email: 'zach@mo-care.com', full_name: 'Zach Troutman', active: true }],
    staff_roles: lead ? [{ entity: 'cc_ihs', role: 'springfield_lead', person_id: 'k' }] : [],
    domains: [{ entity: 'cc_ihs', code: 'payer_programs', owner_person: null, escalation_person: esc || null, active: false }] })
  DB = base(undefined); ck('switch · off when not set', (await N.routingBySettings(db)) === false)
  DB = base('yes'); ck('switch · off unless exactly true', (await N.routingBySettings(db)) === false)
  DB = base(true); ck('switch · on when true', (await N.routingBySettings(db)) === true)
  DB = base(true, 'z', true); ck('escalationTo · the area\'s escalation person first (Zach)', (await N.escalationTo(db, 'payer_programs')).email === 'zach@mo-care.com')
  DB = base(true, null, true); ck('escalationTo · no escalation person: the Springfield lead (Krystal)', (await N.escalationTo(db, 'payer_programs')).email === 'krystal@mo-care.com')
  DB = base(true, null, false); ck('escalationTo · nobody set up: Samantha, so it never goes to nobody', (await N.escalationTo(db, 'payer_programs')).email === 'samantha@mo-care.com')
  DB = base(true, null, true); ck('noticeTo · Payer Programs switched off and unowned: the Springfield lead', (await N.noticeTo(db, 'payer_programs')).email === 'krystal@mo-care.com')
  DB = { from() { throw new Error('down') } }; ck('a database failure reads as switched off (never throws)', (await N.routingBySettings({ from() { throw new Error('down') } })) === false)
  /* the four jobs: the new route only behind the switch; the old Samantha line still there for when it is off */
  const src = (f) => fs.readFileSync(path.join(F, f, 'index.ts'), 'utf8')
  const g = src('ghe-reminders')
  ck('ghe-reminders · the Medicaid coordinator falls back by settings only when on, else Samantha as before', /if \(await routingBySettings\(supabase\)\) \{ const n = await noticeTo\(supabase, 'payer_programs'\)/.test(g) && /return \{ email: OWNER, why: 'nobody owns Payer Programs yet, so Samantha' \}/.test(g))
  ck('ghe-reminders · "still not booked" email and digest go to upTo (escalation person when on, Samantha when off)', /const upTo = \(await routingBySettings\(supabase\)\) \? \(await escalationTo\(supabase, 'payer_programs'\)\)\.email : OWNER/.test(g) && /to: \[upTo\]/.test(g) && /new Set<string>\(\[upTo, coord\.email\]\)/.test(g) && !/to: \[OWNER\]/.test(g))
  for (const [fn, area] of [['medicaid-visits', 'code'], ['nurse-visit-check', "'payer_programs'"], ['rn-review', "'payer_programs'"]]) {
    const s = src(fn)
    ck(fn + ' · falls back by settings only when on, else Samantha as before', s.includes('if (await routingBySettings(db)) return (await noticeTo(db, ' + area + ')).email') && (/return OWNER\n\}/.test(s) || /return 'samantha@mo-care\.com'\n\}/.test(s)))
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
