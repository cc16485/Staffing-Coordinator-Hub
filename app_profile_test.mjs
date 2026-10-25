// The client profile in the Booking App (Samantha 2026-10-25). Under Node against the REAL _shared files, fake data only.
//   node app_profile_test.mjs
import path from 'path'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const imp = (f) => import(pathToFileURL(path.resolve('supabase/functions/_shared', f)).href)
const P = await imp('app-profile.ts'), fam = await imp('family-app.ts'), SO = await imp('shift-offer.ts')

// the profile shape
const full = P.appProfile({ about: 'Dorothy taught school for 30 years.', enjoys: ['Gardening', 'Sweet tea'], help: ['Companionship'], needs: [], home: ['Cats in the home'], level: 1 }, SO.sceneFor(['Gardening']))
ck('appProfile: About, enjoys, Good to know, level and the garden picture', full.about === 'Dorothy taught school for 30 years.' && full.enjoys.length === 2 && full.home[0] === 'Cats in the home' && full.level === 1 && full.scene === 'garden' && full.basics === false, full)
const none = P.appProfile({ about: null, enjoys: [], help: [], needs: [], home: [], level: null }, SO.sceneFor([]))
ck('appProfile: nothing approved = basics (the request still goes out)', none.basics === true && none.about === null && none.scene === 'porch', none)
ck('appProfile: null info is safe', P.appProfile(null, '').basics === true)

// suggestions
ck('cleanSuggestion: empty, too long and links refused; a normal one kept', !P.cleanSuggestion('  ').ok && !P.cleanSuggestion('x'.repeat(501)).ok && !P.cleanSuggestion('see www.x.com').ok && P.cleanSuggestion('  She loves  Wheel of Fortune ').text === 'She loves Wheel of Fortune')
ck('SUGGEST_THANKS: says nothing changes until we look, no em dash', /before anything changes/.test(P.SUGGEST_THANKS('Dot')) && !/—/.test(P.SUGGEST_THANKS('Dot')))

// the family door
const NOW = new Date('2026-10-20T14:00:00Z')
let W
const ax = async (m, p) => {
  const u = new URL('http://x' + p)
  if (m === 'GET' && u.pathname === '/api/clients/501') return { status: 200, json: { results: { client: { id: 501, firstName: 'Dorothy', goesBy: 'Dot', status: { active: true }, residentialAddress: { state: 'MO', city: 'Nixa' } } } } }
  return { status: 404, json: { errors: ['none'] } }
}
const deps = () => ({
  ax, now: () => NOW, supabaseUrl: 'https://h.co', settings: async () => W.settings,
  whoIs: async () => [{ contact_id: 9, name: 'Lisa Ray', circle_id: 'c1', axiscare_client_id: '501', client_name: 'Dorothy Ray', can_book: true }],
  profiles: async () => [], bookings: async () => [], insertBooking: async () => null, updateBooking: async () => true, officeItem: async () => true,
  event: async (row) => { W.events.push(row) },
  caregiverView: async (id, client) => { W.viewFor = [id, client?.id]; return full },
  suggest: { openCount: async () => W.open, add: async (row) => { if (W.addFails) return false; W.added.push(row); return true } },
})
const go = (body) => fam.familyAction(deps(), { id: 'u', email: 'lisa@x.test' }, { client: '501', ...body })
const reset = (st = {}) => { W = { settings: { family_fee_check_ready: true, ...st }, events: [], added: [], open: 0, addFails: false } }

reset()
let o = await go({ action: 'home' })
ck('switch OFF: home has no "What caregivers see" (as before)', o.status === 200 && !('cg_view' in o.body) && !('can_suggest' in o.body), o)
o = await go({ action: 'suggest_profile', text: 'She loves cards' })
ck('switch OFF: Suggest a change refused, nothing saved', o.status === 409 && W.added.length === 0, o)

reset({ app_profile_live: true })
o = await go({ action: 'home' })
ck('switch ON: home carries what caregivers see, the town, and Suggest a change', o.status === 200 && o.body.cg_view?.about === full.about && o.body.cg_view.town === 'Nixa' && o.body.can_suggest === true && W.viewFor[0] === '501', o.body.cg_view)
o = await go({ action: 'suggest_profile', text: '' })
ck('switch ON: an empty suggestion is refused', o.status === 400 && W.added.length === 0, o)
o = await go({ action: 'suggest_profile', text: 'She calls herself Dot, not Dorothy.' })
ck('switch ON: a suggestion is saved for the office, with who sent it, and logged', o.status === 200 && /before anything changes/.test(o.body.message) && W.added.length === 1 && W.added[0].axiscare_client_id === '501' && W.added[0].contact_id === 9 && W.added[0].contact_name === 'Lisa Ray' && W.events.some((e) => e.verb === 'family_profile_suggestion'), { o, W })
W.open = 3; o = await go({ action: 'suggest_profile', text: 'Another one' })
ck('switch ON: 3 open suggestions from this person = wait', o.status === 409 && W.added.length === 1, o)
W.open = null; o = await go({ action: 'suggest_profile', text: 'Another one' })
ck('switch ON: the count can\'t be read = not sent, says try again (never unlimited)', o.status === 503 && W.added.length === 1, o)
W.open = 0; W.addFails = true; o = await go({ action: 'suggest_profile', text: 'Another one' })
ck('switch ON: a save that fails says it didn\'t send', o.status === 500 && /didn't send/.test(o.body.error), o)

for (const [n, okk, note] of res) console.log((okk ? '  ✓ ' : '  ✗ ') + n + (okk ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`\n  app profile: ${res.length - bad}/${res.length} passed`)
process.exit(bad ? 1 : 0)
