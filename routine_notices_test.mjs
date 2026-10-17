// SOP ruling 8 (2026-10-17) · routine notices go to the work area owner, then the Springfield lead, then Samantha, and
// leave a card owners can see. _shared/notice-to.ts against a fake database, plus scans of every sender it replaced.
// node routine_notices_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
let T
const reset = (over = {}) => { T = { domains: [{ entity: 'cc_ihs', code: 'family_enquiries', owner_person: 'p-an', active: true }, { entity: 'cc_ihs', code: 'client_care', owner_person: 'p-gone', active: true },
  { entity: 'cc_ihs', code: 'scheduling_coverage', owner_person: 'p-kr', active: true }, { entity: 'cc_ihs', code: 'old_area', owner_person: 'p-an', active: false }],
  persons: [{ person_id: 'p-an', primary_email: 'Angiel@mo-care.com', full_name: 'Angiel Test', active: true }, { person_id: 'p-kr', primary_email: 'krystal@mo-care.com', full_name: 'Krystal Lead', active: true },
    { person_id: 'p-gone', primary_email: 'gone@mo-care.com', full_name: 'Gone Person', active: false }],
  staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'springfield_lead' }, { person_id: 'p-kr', entity: 'cc_ihs', role: 'care_coordinator' }],
  app_data: { ops_items: [], ops_settings: {} }, ...over } }
const db = {
  from(t) { const st = {}; const rows = () => (T[t] || []).filter((r) => Object.entries(st).every(([c, v]) => String(r[c]).toLowerCase() === String(v).toLowerCase()))
    const b = { select() { return b }, eq(c, v) { st[c] = v; return b }, ilike(c, v) { st[c] = v; return b },
      maybeSingle: async () => t === 'app_data' ? ({ data: st.key in T.app_data ? { data: T.app_data[st.key] } : null, error: null }) : ({ data: rows()[0] ?? null, error: null }),
      then(ok) { return Promise.resolve({ data: rows(), error: null }).then(ok) } }; return b },
  async rpc(name, a) { if (name !== 'upsert_app_data_item') return { error: 'no' }; const l = T.app_data[a.target_key] ||= []; const i = l.findIndex((x) => x.id === a.item.id); if (i >= 0) l[i] = a.item; else l.push(a.item); return { error: null } },
}
const N = await import(path.resolve(FN, '_shared/notice-to.ts'))

reset()
let r = await N.noticeTo(db, 'family_enquiries')
ck('the work area owner gets it first (email lower-cased, full name kept)', r.email === 'angiel@mo-care.com' && r.name === 'Angiel Test' && r.why === 'area_owner', r)
r = await N.noticeTo(db, 'client_care')
ck('an owner who is no longer active is skipped: the Springfield lead gets it', r.email === 'krystal@mo-care.com' && r.why === 'springfield_lead', r)
r = await N.noticeTo(db, 'old_area')
ck('a work area switched off is skipped too', r.why === 'springfield_lead', r)
r = await N.noticeTo(db)
ck('no work area named: the Springfield lead', r.email === 'krystal@mo-care.com' && r.name === 'Krystal Lead', r)
reset({ staff_roles: [] })
r = await N.noticeTo(db, 'client_care')
ck('nobody owns it and there is no Springfield lead: Samantha, so nothing goes to nobody', r.email === 'samantha@mo-care.com' && r.why === 'last_resort', r)
reset({ domains: [], persons: [], staff_roles: [] })
ck('an empty database never throws and still names Samantha', (await N.noticeTo(db, 'x')).email === 'samantha@mo-care.com')
reset()
ck('empty alert list: the area owner and the lead, once each', JSON.stringify(await N.fallbackList(db, 'scheduling_coverage')) === '["krystal@mo-care.com"]'
  && JSON.stringify(await N.fallbackList(db, 'family_enquiries')) === '["angiel@mo-care.com","krystal@mo-care.com"]')
reset({ staff_roles: [], domains: [] })
ck('empty alert list with nobody set: Samantha alone', JSON.stringify(await N.fallbackList(db, 'scheduling_coverage')) === '["samantha@mo-care.com"]')
reset()
const to = await N.noticeTo(db, 'family_enquiries')
const c = { id: 'ops_t1', kind: 'request', domain: 'family_enquiries', title: 'Call them', detail: 'd', created_by: 'test' }
ck('a notice card is raised once, owned by the person told, with their name and why', await N.noticeCard(db, to, c) === 'raised'
  && T.app_data.ops_items.length === 1 && T.app_data.ops_items[0].owner === 'angiel@mo-care.com' && T.app_data.ops_items[0].owner_name === 'Angiel Test' && T.app_data.ops_items[0].owner_why === 'area_owner', T.app_data.ops_items)
ck('raising it again does not make a second card', await N.noticeCard(db, to, c) === 'open' && T.app_data.ops_items.length === 1)
T.app_data.ops_items[0].status = 'done'
ck('a card someone closed stays closed', await N.noticeCard(db, to, c) === 'closed' && T.app_data.ops_items[0].status === 'done')
reset({ app_data: { ops_items: [], ops_settings: { partner_desk: { default_owner: 'Angiel@mo-care.com' } } } })
r = await N.partnerDeskTo(db)
ck('417 notices: the Referral Desk default owner the owners set', r.email === 'angiel@mo-care.com' && r.name === 'Angiel Test', r)
reset()
ck('...and the Springfield lead when no default owner is set', (await N.partnerDeskTo(db)).email === 'krystal@mo-care.com')

/* scans: the routine senders name nobody in the code any more */
const read = (f) => fs.readFileSync(path.join(FN, f), 'utf8')
for (const f of ['cc-booking', 'cc-feedback', 'cc-story', 'cc-corner', 'cc-417', 'campaign-auto', 'coverage-watch', 'coverage-run', 'staff-contacts-check', 'lead-intake', 'care-packet-watch']) {
  const s = read(f + '/index.ts')
  const lit = (s.match(/['"`]samantha@mo-care\.com['"`]/g) || []).length
  // campaign-auto: buildEmailHTML's default parameter, used only if no one is passed; coverage-run: the retired
  // automatic-waves escalation (AUTO_WAVES_RETIRED = true), which never runs
  const allowed = f === 'campaign-auto' || f === 'coverage-run' ? 1 : 0
  ck(`scan · ${f}: no samantha@ literal left (it asks notice-to.ts)`, lit === allowed && /from '\.\.\/_shared\/notice-to\.ts'/.test(s), lit)
}
const cl = read('_shared/clockin-admins.ts')
ck('scan · clockin-admins: the missed clock-in list falls back through notice-to.ts (ADMIN_DEFAULT kept only for timekeeper-watch)', /await fallbackList\(sb, 'scheduling_coverage'\)/.test(cl) && /Kept only for timekeeper-watch/.test(cl))
const fb = read('cc-feedback/index.ts')
ck('scan · cc-feedback: a rating of 3 or less opens a card for the Client care owner', /kind === 'rating' && rating <= 3\) \{\s*await noticeCard\(supabase, officeTo/.test(fb) && /noticeTo\(supabase, kind === 'nomination' \? 'caregivers' : 'client_care'\)/.test(fb))
ck('scan · cc-booking: the booking card is owned by the person told', (read('cc-booking/index.ts').match(/owner: officeTo\.email, owner_name: officeTo\.name/g) || []).length === 2)
ck('scan · cc-story, cc-corner, cc-417: each opens a card', /noticeCard\(supabase, officeTo/.test(read('cc-story/index.ts')) && /noticeCard\(db, to/.test(read('cc-corner/index.ts')) && (read('cc-417/index.ts').match(/noticeCard\(supabase, to/g) || []).length === 2)
const ca = read('campaign-auto/index.ts')
ck('scan · campaign-auto: cards, summary and unsubscribe all use the same person', /owner: to\.email, owner_name: to\.name/.test(ca) && /buildEmailHTML\(e, to\.email\)/.test(ca) && /mailto:\$\{unsub\}/.test(ca))
const nt = read('_shared/notice-to.ts')
ck('notice-to.ts has no em dash', !/—/.test(nt))

let all = true; console.log('\nSOP RULING 8 · ROUTINE NOTICES · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log('\n' + res.filter((x) => x[1]).length + '/' + res.length + ' passed'); process.exit(all ? 0 : 1)
