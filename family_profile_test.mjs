// The family's own profile in the Booking App + the app activity record (Samantha 2026-10-25). Node, REAL _shared files, fake data.
//   node family_profile_test.mjs
import path from 'path'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const imp = (f) => import(pathToFileURL(path.resolve('supabase/functions/_shared', f)).href)
const FP = await imp('family-profile.ts'), AP = await imp('app-profile.ts'), fam = await imp('family-app.ts'), off = await imp('family-app-office.ts')

// the checks
const good = { about: 'Dot taught third grade for 30 years.', work: 'A teacher, then the church choir.', talk: 'Her grandkids, the Cardinals, old movies.', little: 'Sweet tea on the porch.', enjoys: 'Gardening, Sweet tea, Crosswords' }
const c = FP.cleanFamilyProfile(good)
ck('a warm profile passes; enjoys from a comma list', c.ok && c.profile.enjoys.length === 3 && c.profile.little === 'Sweet tea on the porch.', c)
const bad = (o) => FP.cleanFamilyProfile({ ...good, ...o })
ck('an address is stopped, pointing at the box', !bad({ about: 'She lives at 1234 Elm Street.' }).ok && bad({ about: 'She lives at 1234 Elm Street.' }).field === 'about')
ck('a phone number or email is stopped', !bad({ talk: 'Call me at 417-555-1212' }).ok && !bad({ work: 'email me a@b.co' }).ok)
ck('money and banking are stopped', !bad({ little: 'Keep $20 in her purse' }).ok && !bad({ talk: 'her bank account' }).ok)
ck('health details are stopped (conditions, medicines, personal care)', ['She has dementia.', 'Give her meds at noon.', 'Help her shower.', 'She is a fall risk'].every((t) => /health details/.test(bad({ about: t }).error || '')))
ck('too long, too many enjoys, links: stopped', !bad({ about: 'x'.repeat(401) }).ok && !bad({ enjoys: 'a,b,c,d,e,f,g' }).ok && !bad({ talk: 'see www.x.com' }).ok)
ck('an empty profile is allowed (clears it)', FP.cleanFamilyProfile({}).ok && FP.isEmpty(FP.cleanFamilyProfile({}).profile))

// the save and the history
const s1 = FP.applyFamilySave(null, c.profile, { contact_id: 9, name: 'Lisa Ray' }, '501', '2026-10-25T15:00:00Z', 'checked')
ck('first save: all fields recorded as changes, who, history', s1.changes.length === 5 && s1.row.updated_by_name === 'Lisa Ray' && s1.row.history.length === 1 && s1.row.created_at)
const s2 = FP.applyFamilySave(s1.row, { ...c.profile, little: 'Coffee at 10.' }, { contact_id: 9, name: 'Lisa Ray' }, '501', '2026-10-26T15:00:00Z', 'checked')
ck('a change keeps the words before and after', s2.changes.length === 1 && s2.changes[0].before === 'Sweet tea on the porch.' && s2.changes[0].after === 'Coffee at 10.' && s2.row.history.length === 2)
const w = FP.familyWordsForOffice(c.profile)
ck('Use the family\'s words: About made from their answers, under 400, enjoys kept', w.about.startsWith('Dot taught third grade') && w.about.length <= 400 && w.enjoys.length === 3)

// what caregivers see
const info = { about: 'Office about.', enjoys: ['Bingo'], help: ['Companionship'], needs: [], home: ['Cats in the home'], level: 1 }
const vf = AP.appProfile(info, 'garden', c.profile), vo = AP.appProfile(info, 'porch', null)
ck('family wrote one: offers show the family\'s words (About, life answers, enjoys) with the care plan parts', vf.source === 'family' && vf.about === good.about && vf.life.length === 3 && vf.enjoys.includes('Crosswords') && vf.home[0] === 'Cats in the home' && !vf.enjoys.includes('Bingo'))
ck('no family profile: the office\'s approved profile, as before', vo.source === 'office' && vo.about === 'Office about.' && vo.life.length === 0)

// the family door
const NOW = new Date('2026-10-20T14:00:00Z')
let W
const ax = async (m, p) => new URL('http://x' + p).pathname === '/api/clients/501' ? { status: 200, json: { results: { client: { id: 501, firstName: 'Dorothy', goesBy: 'Dot', status: { active: true }, residentialAddress: { state: 'MO', city: 'Nixa' } } } } } : { status: 404, json: {} }
const deps = (canBook = true) => ({
  ax, now: () => NOW, supabaseUrl: 'https://h.co', settings: async () => W.settings,
  whoIs: async () => [{ contact_id: 9, name: 'Lisa Ray', circle_id: 'c1', axiscare_client_id: '501', client_name: 'Dorothy Ray', can_book: canBook }],
  profiles: async () => [], bookings: async () => [], insertBooking: async () => null, updateBooking: async () => true, officeItem: async () => true,
  event: async (row) => { W.events.push(row) },
  caregiverView: async (id, client, f) => AP.appProfile(info, 'porch', f ?? null),
  familyProfile: { get: async () => W.readFails ? undefined : W.row, save: async (row) => { if (W.saveFails) return false; W.row = row; return true }, aiCheck: async () => W.ai },
  activity: async (row) => { W.acts.push(row) }, opened: async (who) => { W.opens.push(who.length) },
})
const go = (body, canBook) => fam.familyAction(deps(canBook), { id: 'u', email: 'lisa@x.test' }, { client: '501', ...body })
const reset = (st = {}) => { W = { settings: { family_fee_check_ready: true, app_profile_live: true, ...st }, events: [], acts: [], opens: [], row: null, ai: { ok: true, why: '' }, readFails: false, saveFails: false } }

reset()
let o = await go({ action: 'me' })
ck('every app open is recorded for the Hub page (me)', o.status === 200 && W.opens.length === 1)
o = await go({ action: 'home' })
ck('family_profile_live OFF: no editor, Suggest a change as before', !('family_profile' in o.body) && o.body.can_suggest === false, o.body)
o = await go({ action: 'save_profile', profile: good })
ck('family_profile_live OFF: saving refused, nothing saved', o.status === 409 && !W.row)

reset({ family_profile_live: true })
o = await go({ action: 'home' })
ck('ON: home has the editor (empty), the three questions, and no Suggest a change', o.body.family_profile && o.body.family_profile.can_edit === true && o.body.family_profile.questions.length === 3 && o.body.can_suggest === false && o.body.cg_view.source === 'office', o.body)
o = await go({ action: 'save_profile', profile: good }, false)
ck('ON: a see-only login can\'t write it', o.status === 403 && !W.row)
o = await go({ action: 'save_profile', profile: { ...good, about: 'She has dementia.' } })
ck('ON: a health detail is stopped with the reason and the box; nothing saved; the stop is recorded', o.status === 400 && o.body.field === 'about' && /health details/.test(o.body.error) && !W.row && W.acts.some((a) => a.kind === 'profile_blocked'), o.body)
W.ai = { ok: false, why: 'Please leave out the part about her son\'s divorce.' }
o = await go({ action: 'save_profile', profile: good })
ck('ON: the AI check can stop it too, in its own words; nothing saved', o.status === 400 && /divorce/.test(o.body.error) && !W.row, o.body)
W.ai = { ok: true, why: '' }
o = await go({ action: 'save_profile', profile: good })
ck('ON: saved straight away (no office step); caregivers see the family\'s version now; recorded and logged', o.status === 200 && W.row?.about === good.about && o.body.cg_view.source === 'family' && /Saved\. Caregivers see this/.test(o.body.message) && W.acts.some((a) => a.kind === 'profile_saved') && W.events.some((e) => e.verb === 'family_profile_saved'), o.body)
const acts = W.acts.length
o = await go({ action: 'save_profile', profile: good })
ck('ON: saving the same words again changes nothing and records nothing', o.status === 200 && /No changes/.test(o.body.message) && W.acts.length === acts)
W.ai = null
o = await go({ action: 'save_profile', profile: { ...good, little: 'Coffee at 10.' } })
ck('ON: AI unavailable: the fixed rules decide, saved, and the history says the AI look was unavailable', o.status === 200 && W.row.little === 'Coffee at 10.' && W.row.history.slice(-1)[0].ai === 'unavailable', W.row.history)
W.readFails = true; o = await go({ action: 'save_profile', profile: good })
ck('ON: the old profile can\'t be read = not saved, try again', o.status === 503)
W.readFails = false; W.saveFails = true; o = await go({ action: 'save_profile', profile: { ...good, little: 'Tea' } })
ck('ON: a failed save says it didn\'t save', o.status === 500 && /didn't save/.test(o.body.error))

// the office's Booking App page (read only)
const od = { now: () => NOW, activity: async (from) => ({ ok: true, from, people: [{ name: 'Lisa Ray' }] }) }
o = await off.officeAction(od, { name: 'Krystal', email: 'k@x' }, { action: 'activity', days: 30 })
ck('office: the Booking App page read, last 30 days', o.status === 200 && o.body.people[0].name === 'Lisa Ray' && o.body.from.startsWith('2026-09-20'), o.body)
o = await off.officeAction({ now: () => NOW }, { name: 'Krystal', email: 'k@x' }, { action: 'activity' })
ck('office: not set up = says so (never an empty page pretending)', o.status === 501)

for (const [n, okk, note] of res) console.log((okk ? '  ✓ ' : '  ✗ ') + n + (okk ? '' : '\n      ' + note))
const badN = res.filter((x) => !x[1]).length
console.log(`\n  family profile: ${res.length - badN}/${res.length} passed`)
process.exit(badN ? 1 : 0)
