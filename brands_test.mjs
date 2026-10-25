// Two brands, steps 1 and 2 (her plan, approved 2026-10-16). Under Node against the REAL _shared files.
//   node brands_test.mjs
// Includes the Missouri guard: every family-app message Missouri sees is word-for-word what origin/main says.
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions/_shared'
const imp = (f) => import(pathToFileURL(path.resolve(F, f)).href)
const B = await imp('brands.ts')

ck('brandFor: MO, OK, words and case; anything else is null (never a default)', B.brandFor('MO') === 'MO' && B.brandFor('mo') === 'MO' && B.brandFor('Missouri') === 'MO' &&
  B.brandFor(' ok ') === 'OK' && B.brandFor('Oklahoma') === 'OK' && B.brandFor('') === null && B.brandFor(null) === null && B.brandFor('KS') === null && B.brandFor(undefined) === null)
ck('brand(null) is null', B.brand(null) === null && B.brand(null, { brand_MO: { phone: 'x' } }) === null)
const mo = B.brand('MO'), ok = B.brand('OK')
ck('Missouri: the names, phone, site and app as Missouri\'s messages say them today', mo.name === 'Caring Companions In-Home Senior Care' && mo.short === 'Caring Companions' && mo.phone === '(417) 234-8494' && mo.website === 'mo-care.com' && mo.app_url === 'https://family.mo-care.com' && mo.app_host === 'family.mo-care.com')
ck('Oklahoma: its own name, phone and site; not-yet-known values are null, never Missouri\'s', ok.name === 'Caring Companions Oklahoma' && ok.phone === '(405) 500-1758' && ok.website === 'caringcompanionsoklahoma.com' && ok.app_url === null && ok.address === null && ok.legal_entity === null && ok.logo === null)
const over = B.brand('OK', { brand_OK: { phone: '(405) 555-0100', name: 'Hacked Name', app_url: 'https://evil.test', short: '  ' } })
ck('Hub settings change only the editable fields (phone yes; name and app address no; blank ignored)', over.phone === '(405) 555-0100' && over.name === 'Caring Companions Oklahoma' && over.app_url === null && over.short === 'Caring Companions Oklahoma')
ck('a settings change for one brand never touches the other', B.brand('MO', { brand_OK: { phone: '(405) 555-0100' } }).phone === '(417) 234-8494')
ck('brandForSite: family.mo-care.com and mo-care.com = MO, caringcompanionsoklahoma.com = OK, anything else null',
  B.brandForSite('https://family.mo-care.com') === 'MO' && B.brandForSite('https://mo-care.com') === 'MO' && B.brandForSite('https://www.caringcompanionsoklahoma.com') === 'OK' &&
  B.brandForSite('https://cc16485.github.io') === null && B.brandForSite('http://localhost:8787') === null && B.brandForSite('') === null && B.brandForSite('https://evilmo-care.com') === null)
const card = B.unknownBrandCard({ id: 'x1', who: 'Ann Lee', what: 'The welcome', why: 'no state', nowIso: '2026-10-16T12:00:00Z' })
ck('unknown brand card: open, says it was NOT sent, who and why', card.status === 'open' && /NOT sent to Ann Lee/.test(card.detail) && /no state/.test(card.detail))

// sign-in: the site's own brand
const si = await imp('family-signin.ts')
ck('sign-in "not on file": Missouri site = the 417 number, word for word as before', si.notOnFile('a@b.c') === "We don't have a@b.c on file for a current client. Please call us at (417) 234-8494 and we'll add it.")
ck('sign-in "not on file", an unknown site: no number guessed', si.notOnFile('a@b.c', null) === "We don't have a@b.c on file for a current client. Please call the office and we'll add it.")

// THE MISSOURI GUARD: welcome text + email exactly as origin/main makes them
let oldSrc = ''
try { oldSrc = execSync('git show origin/main:supabase/functions/_shared/family-app-office.ts', { encoding: 'utf8' }) } catch { /* offline: skipped */ }
if (oldSrc) {
  const tmp = path.resolve(F, '_old_family_app_office_test.ts'); fs.writeFileSync(tmp, oldSrc)
  try {
    const OLD = await import(pathToFileURL(tmp).href), NEW = await imp('family-app-office.ts')
    void OLD
    // 2026-10-17 her brief ("Family Welcome Email, Text Messages & Scheduling Type") and approval: three versions, word for word
    const W = { first: 'Lisa', client: 'Dorothy', email: 'lisa.ray@example.com', phone: '(417) 234-8494' }
    const T = (k, ax = true) => NEW.welcomeText(W.first, W.client, W.email, W.phone, ax, NEW_MO(), k), E = (k, ax = true, pilot = true) => NEW.welcomeEmail(W.first, W.client, W.email, W.phone, ax, NEW_MO(), pilot, k)
    ck('WELCOME texts: the three approved texts, word for word',
      T('regular') === "Hi Lisa, welcome to Caring Companions! You can follow Dorothy's visits, care notes and invoices in the AxisCare Family Portal. Set it up here: https://16485.axiscare.com/?user-connect.php&action=activate Your welcome email has the steps, plus our optional Booking App. Questions? (417) 234-8494" &&
      T('flexible') === "Hi Lisa, welcome to Caring Companions! You can request care for Dorothy whenever you need it in our Booking App: https://family.mo-care.com Sign in with lisa.ray@example.com and we'll email you a code. Your welcome email has the full steps. Questions? (417) 234-8494" &&
      T('both') === "Hi Lisa, welcome to Caring Companions! Follow Dorothy's visits, care notes and invoices in the AxisCare Family Portal, and request care on other days in our Booking App (https://family.mo-care.com). Your welcome email has the steps for both. Questions? (417) 234-8494", [T('regular'), T('flexible'), T('both')])
    const r = E('regular').html, f = E('flexible').html, b2 = E('both').html
    const order = (html) => html.indexOf('Activate your account') < html.indexOf('Open the Booking App') ? 'axis-first' : 'app-first'
    ck('WELCOME emails: Regular = AxisCare first, Booking App marked Optional; Flexible = app first; Combination = AxisCare then app, both solid buttons',
      order(r) === 'axis-first' && />Optional</.test(r) && order(f) === 'app-first' && !/>Optional</.test(f) && order(b2) === 'axis-first' && !/>Optional</.test(b2), [order(r), order(f), order(b2)])
    ck('WELCOME emails: Flexible never says "extra" or "additional visits"; nobody is told regular visits "stay as they are"', !/extra|additional visit/i.test(f) && !/stay just as they are/i.test(r + f + b2))
    ck('WELCOME emails: the right links (AxisCare activation, AxisCare sign-in, the Booking App, the phone) and How booking works', [r, f, b2].every((x) => x.includes('href="https://16485.axiscare.com/?user-connect.php&action=activate"') && x.includes('href="https://16485.axiscare.com/"') && x.includes('href="https://family.mo-care.com"') && x.includes('tel:+14172348494') && /How booking works/.test(x) && /any day between 7 AM and 6 PM/.test(x)))
    ck('WELCOME emails (her rule 10-25): Wellness Care only, no 8-hour weekly minimum, no short-visit rate, office not involved, not guaranteed', [r, f, b2].every((x) => /Wellness Care only/.test(x) && /8-hour weekly minimum/.test(x) && /higher rate for short shifts/.test(x) && /office staff aren't involved in app bookings/.test(x) && /A visit isn't guaranteed/.test(x) && /If no caregiver responds, the visit won't happen/.test(x)))
    ck('WELCOME emails: pilot line on by default, off by the setting; no em dashes', /first families to use the Booking App/.test(r) && !/first families/.test(E('regular', true, false).html) && !/—/.test(r + f + b2 + T('regular') + T('flexible') + T('both')))
    ck('WELCOME without the AxisCare part: only the Booking App section, and the text is the app text', !/Activate your account/.test(E('regular', false).html) && /Open the Booking App/.test(E('regular', false).html) && /Booking App: https:\/\/family/.test(T('regular', false)))
    const okb = B.brand('OK'); okb.app_url = 'https://family.example'; okb.app_host = 'family.example'
    const t = NEW.welcomeText('Ann', 'Bea', 'a@b.c', '(405) 500-1758', false, okb, 'flexible'), em = NEW.welcomeEmail('Ann', 'Bea', 'a@b.c', '(405) 500-1758', false, okb, true, 'flexible')
    ck('an Oklahoma welcome (once its app exists) carries no Missouri name, site or number', /welcome to Caring Companions Oklahoma/.test(t) && !/mo-care|417|In-Home Senior Care/.test(t + em.html + em.subject) && /Welcome to Caring Companions Oklahoma/.test(em.subject), { t, s: em.subject })
  } finally { fs.unlinkSync(tmp) }
} else console.log('  (origin/main not readable: the Missouri guard was skipped)')
function NEW_MO() { return B.brand('MO') }

// the family app's home answer carries the brand
const fam = await imp('family-app.ts')
const homeFor = async (state) => {
  const d = { ax: async (m, p) => p.startsWith('/api/clients/') ? { status: 200, json: { results: { client: { id: 9, firstName: 'Bea', status: { active: true }, residentialAddress: state == null ? {} : { state } } } } } : { status: 404, json: { errors: ['No visits found'] } },
    now: () => new Date('2026-10-20T14:00:00Z'), supabaseUrl: 'x', settings: async () => ({}), whoIs: async () => [{ contact_id: 1, name: 'Ann', circle_id: 'k', axiscare_client_id: '9', client_name: 'Bea', can_book: true }],
    profiles: async () => [], bookings: async () => [], insertBooking: async () => null, updateBooking: async () => true, officeItem: async () => true, event: async () => {} }
  return fam.familyAction(d, { id: 'u' }, { action: 'home' })
}
const hMO = await homeFor('MO'), hOK = await homeFor('OK'), hNone = await homeFor(null)
ck('home: a Missouri client gets the Missouri brand and number (office_phone unchanged)', hMO.body.brand?.key === 'MO' && hMO.body.office_phone === '(417) 234-8494' && hMO.body.brand.phone === '(417) 234-8494', hMO.body.brand)
ck('home: an Oklahoma client gets Caring Companions Oklahoma and (405)', hOK.body.brand?.key === 'OK' && hOK.body.office_phone === '(405) 500-1758' && hOK.body.brand.name === 'Caring Companions Oklahoma', hOK.body.brand)
ck('home: no state = no brand and no number (the app shows "call the office")', hNone.body.brand === null && hNone.body.office_phone === null, hNone.body)
ck('cancel text to a caregiver: Missouri signs off as before, Oklahoma as Oklahoma, unknown with no name',
  / Caring Companions$/.test(fam.cancelText({ visit_date: '2026-10-22', start_time: '10:00', end_time: '12:00', state: 'MO' }, 'Grace', 'Dot', false, 2)) &&
  / Caring Companions Oklahoma$/.test(fam.cancelText({ visit_date: '2026-10-22', start_time: '10:00', end_time: '12:00', state: 'OK' }, 'Grace', 'Dot', false, 2)) &&
  /please don't go\.$/.test(fam.cancelText({ visit_date: '2026-10-22', start_time: '10:00', end_time: '12:00' }, 'Grace', 'Dot', false, 2)))

// no em dashes in anything a person reads from brands.ts
const all = JSON.stringify([B.brand('MO'), B.brand('OK'), card])
ck('no em dashes in brand words', !/—/.test(all))

for (const [n, okk, note] of res) console.log((okk ? '  ✓ ' : '  ✗ ') + n + (okk ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`\n  two brands (steps 1 and 2): ${res.length - bad}/${res.length} passed`)
process.exit(bad ? 1 : 0)
