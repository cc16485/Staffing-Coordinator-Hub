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
    let same = true, first = null
    for (const withAxis of [true, false]) for (const [f, c, e, p] of [['Lisa', 'Dorothy', 'lisa@x.test', '(417) 234-8494'], ['Tom', 'Earl', 'tom+1@x.test', '(417) 555-0000']]) {
      const a = [OLD.welcomeText(f, c, p, withAxis), JSON.stringify(OLD.welcomeEmail(f, c, e, p, withAxis))]
      const b = [NEW.welcomeText(f, c, p, withAxis, NEW_MO()), JSON.stringify(NEW.welcomeEmail(f, c, e, p, withAxis, NEW_MO()))]
      const b2 = [NEW.welcomeText(f, c, p, withAxis), JSON.stringify(NEW.welcomeEmail(f, c, e, p, withAxis))]
      if (a[0] !== b[0] || a[1] !== b[1] || a[0] !== b2[0] || a[1] !== b2[1]) { same = false; first = first ?? { a, b } }
    }
    ck('MISSOURI GUARD: the welcome text and email are word-for-word what origin/main sends', same, first)
    const okb = B.brand('OK'); okb.app_url = 'https://family.example'; okb.app_host = 'family.example'
    const t = NEW.welcomeText('Ann', 'Bea', '(405) 500-1758', false, okb), em = NEW.welcomeEmail('Ann', 'Bea', 'a@b.c', '(405) 500-1758', false, okb)
    ck('an Oklahoma welcome (once its app exists) carries no Missouri name, site or number', /it's Caring Companions Oklahoma/.test(t) && !/mo-care|417|In-Home Senior Care/.test(t + em.html + em.subject) && /Caring Companions Oklahoma family access/.test(em.subject), { t, s: em.subject })
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
