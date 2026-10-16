// =============================================================================
// brands — the two customer-facing brands, in ONE place (her two-brand plan, approved 2026-10-16: "brand steps 1 and 2").
//   MO = Caring Companions In-Home Senior Care, mo-care.com
//   OK = Caring Companions Oklahoma, caringcompanionsoklahoma.com
// Every text, email, page and PDF that names the company, its phone, website or sign-off should read it from here.
//
// THE ONE RULE: a brand is never guessed. brandFor() answers 'MO', 'OK' or null, and null means DON'T SEND: the caller
// raises a Needs Attention card naming who and why (unknownBrandCard). Never `?? 'MO'`, never "not Oklahoma = Missouri".
//
// The Missouri values are exactly what Missouri's messages say today, so moving a sender onto this file changes nothing
// Missouri sees (each move carries a word-for-word test). Phone numbers, sender names and sign-offs can be changed per brand
// in the Hub settings (ops_settings.brand_MO / brand_OK, only the EDITABLE fields below); everything else changes here,
// in review. The legal entity is kept apart from the brand on purpose: two brands are not assumed to be two companies.
// A value that is null is not known yet: a sender that needs it refuses (and says which value is missing), never borrows
// the other brand's.
// =============================================================================

export type BrandKey = 'MO' | 'OK'
export type Brand = {
  key: BrandKey
  name: string              // customer-facing full name
  short: string             // text sign-off and "it's ___"
  website: string           // bare domain, as written in messages
  phone: string             // main office line, as written in messages
  after_hours_phone: string
  email_from_name: string
  email_address: string | null   // null: the GHL account's default sender (Missouri today); Oklahoma: not set up yet
  address: string | null
  app_url: string | null    // the family app; null = not set up for this brand yet (Oklahoma: her decision pending)
  app_host: string | null   // bare host of app_url, as written in messages
  logo: string | null       // public URL of the logo for emails and pages
  colors: { primary: string; dark: string; accent: string }
  footer: string            // email footer line
  legal_entity: string | null    // kept separate from the brand; not shown to customers unless a document needs it
  license_line: string | null
}

const BASE: Record<BrandKey, Brand> = {
  MO: {
    key: 'MO', name: 'Caring Companions In-Home Senior Care', short: 'Caring Companions', website: 'mo-care.com',
    phone: '(417) 234-8494', after_hours_phone: '(417) 234-8494', email_from_name: 'Caring Companions', email_address: null,
    address: '1331 N Stewart Ave Ste B, Springfield, MO 65802',
    app_url: 'https://family.mo-care.com', app_host: 'family.mo-care.com', logo: 'https://mo-care.com/email-assets/cc-logo.png',
    colors: { primary: '#1F7A8C', dark: '#0D365F', accent: '#F0A63A' },
    footer: 'Caring Companions In-Home Senior Care',
    legal_entity: 'Troutman Enterprises, LLC DBA Caring Companions In-Home Senior Care', license_line: null,
  },
  OK: {
    key: 'OK', name: 'Caring Companions Oklahoma', short: 'Caring Companions Oklahoma', website: 'caringcompanionsoklahoma.com',
    phone: '(405) 500-1758', after_hours_phone: '(405) 500-1758', email_from_name: 'Caring Companions Oklahoma', email_address: null,
    address: null,
    app_url: null, app_host: null, logo: null,
    colors: { primary: '#1F7A8C', dark: '#0D365F', accent: '#F0A63A' },
    footer: 'Caring Companions Oklahoma',
    legal_entity: null, license_line: null,
  },
}

/** Fields the office may change in the Hub settings (ops_settings.brand_<KEY>), with the Admin page's change record. */
export const EDITABLE: (keyof Brand)[] = ['phone', 'after_hours_phone', 'email_from_name', 'short', 'footer']

/** 'MO' | 'OK' from a state as AxisCare, an application or a setting writes it ('MO', 'mo', 'Missouri', 'OK', 'Oklahoma'),
 *  else null. Null is an answer: the caller does not send. */
export function brandFor(state: unknown): BrandKey | null {
  const s = String(state ?? '').trim().toUpperCase()
  if (s === 'MO' || s === 'MISSOURI') return 'MO'
  if (s === 'OK' || s === 'OKLAHOMA') return 'OK'
  return null
}

/** The brand with the office's Hub-setting changes laid over it. `key` null = null (never a default). */
// deno-lint-ignore no-explicit-any
export function brand(key: BrandKey | null, st?: any): Brand | null {
  if (!key) return null
  const b: Brand = { ...BASE[key], colors: { ...BASE[key].colors } }
  const over = st?.[`brand_${key}`]
  if (over && typeof over === 'object') for (const f of EDITABLE) {
    const v = over[f]
    if (typeof v === 'string' && v.trim()) (b as Record<string, unknown>)[f] = v.trim()
  }
  return b
}

/** The brand for a website the request came from (the family app's sign-in page, before anyone is known). */
export function brandForSite(origin: unknown): BrandKey | null {
  const host = String(origin ?? '').replace(/^https?:\/\//, '').replace(/[/:].*$/, '').toLowerCase()
  for (const k of ['MO', 'OK'] as BrandKey[]) {
    const b = BASE[k]
    if (host && (host === b.app_host || host === b.website || host.endsWith('.' + b.website))) return k
  }
  return null
}

/** What a page (the family app) needs to show a brand. Null brand = null (the page shows no name or number of its own). */
export function brandView(b: Brand | null) {
  return b ? { key: b.key, name: b.name, short: b.short, website: b.website, phone: b.phone, logo: b.logo, colors: b.colors } : null
}

/** The Needs Attention card for a message that was NOT sent because the person's brand isn't known. */
export function unknownBrandCard(o: { id: string; who: string; what: string; why: string; nowIso: string; domain?: string }) {
  const detail = `${o.what} was NOT sent to ${o.who}: we don't know whether they're Missouri or Oklahoma (${o.why}). Fix their state, then send it again.`
  return { id: o.id, kind: 'brand_unknown', domain: o.domain ?? 'office', status: 'open', urgency: 'today', title: `Not sent, state unknown: ${o.who}`,
    about: o.who, detail, next_action: 'Set their state (AxisCare address, or the office on their record), then send again.',
    created_at: o.nowIso, first_at: o.nowIso, last_at: o.nowIso, last_activity_at: o.nowIso, created_by: 'brand check', opened_by: 'brand check',
    history: [{ at: o.nowIso, by: 'brand check', text: detail }] }
}
