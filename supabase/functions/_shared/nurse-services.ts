// =============================================================================
// nurse-services.ts · THE NURSE SERVICE LIST (LPN nurse visit plan, Samantha approved 2026-10-14; Desktop 707)
// =============================================================================
// Which AxisCare visits are nurse visits, and what each kind needs before it is ready to bill. The list is a setting
// (app_data ops_settings.nurse_services, edited on the Owners Hub Admin page): adding a service is a settings change, not
// a rebuild. When the setting is empty or unreadable, the built-in list below is used.
//
// HOW A VISIT IS MATCHED: each service has `axis`, the AxisCare service names or codes that mean it. A match is a whole-word,
// case-insensitive hit on the visit's service code, procedure code or description. The named services are tried first, in
// list order; a `generic` service (any T1001 "Nurse Visit" the office did not name more exactly) is tried last.
//
// THE BUILT-IN MATCHES ARE ASSUMPTIONS (nobody has seen her AxisCare service list yet): the office books "Nurse Visit (T1001)"
// (the plan, step 4), so most visits will only say T1001 and are told apart by the GHE month (see nurse-bill.ts). Edit
// them on the Admin page once the T1001 service and any named nurse services exist in AxisCare.
//
// Flags: lpn (an LPN may do it), auth (needs the state care plan's authorization), rn_sign (an RN signs every one),
// rn_sign_if_lpn (an RN signs when an LPN did it: the GHE, HCBS 8.00 Appendix 4), note (the AxisCare visit note is its
// documentation), tasks (AxisCare care tasks that must be marked done), generic (the catch-all), active.
// No em dashes in anything a person reads. Never "skin assessment" (RSMo 335.016(16)(b)): it is skin monitoring.
// deno-lint-ignore-file no-explicit-any

export type NurseService = {
  key: string; name: string; axis: string[]; lpn: boolean; auth: boolean; rn_sign: boolean; rn_sign_if_lpn: boolean
  note: boolean; tasks: string[]; generic: boolean; priority: boolean; active: boolean
}

const base = { lpn: true, auth: true, rn_sign: false, rn_sign_if_lpn: false, note: true, tasks: [] as string[], generic: false, priority: false, active: true }
export const DEFAULT_NURSE_SERVICES: NurseService[] = [
  { ...base, key: 'med_setup', name: 'Weekly medication organizer setup', axis: ['medication organizer', 'medication setup', 'med setup', 'pill organizer'], priority: true },
  /* the GHE's documentation is the Hub's GHE form (MO 580-2985), so its AxisCare visit note is not required */
  { ...base, key: 'ghe', name: 'General Health Evaluation', axis: ['general health evaluation', 'GHE'], rn_sign_if_lpn: true, note: false, priority: true },
  { ...base, key: 'skin_monitoring', name: 'Skin monitoring', axis: ['skin monitoring', 'skin check'], priority: true },
  { ...base, key: 'nail_care', name: 'Diabetic or medically necessary nail care', axis: ['nail care'] },
  { ...base, key: 'insulin_prefill', name: 'Insulin syringe prefill', axis: ['insulin prefill', 'insulin syringe'] },
  { ...base, key: 'nurse_visit', name: 'Authorized nurse visit (not named more exactly)', axis: ['T1001', 'authorized nurse visit', 'nurse visit'], generic: true },
]

const S = (v: unknown, n = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const slug = (v: unknown) => S(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const bool = (v: unknown, d: boolean) => (v === true || v === false ? v : d)
const words = (v: unknown, max = 12) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : []).map((x) => S(x, 80)).filter(Boolean).slice(0, max)

/** One service from the setting, cleaned; null when it has no usable key, name or match. */
export function cleanService(x: any): NurseService | null {
  if (!x || typeof x !== 'object') return null
  const key = slug(x.key || x.name), name = S(x.name, 80), axis = words(x.axis)
  if (!key || !name || !axis.length) return null
  return { key, name, axis, lpn: bool(x.lpn, true), auth: bool(x.auth, true), rn_sign: bool(x.rn_sign, false), rn_sign_if_lpn: bool(x.rn_sign_if_lpn, false),
    note: bool(x.note, true), tasks: words(x.tasks), generic: bool(x.generic, false), priority: bool(x.priority, false), active: bool(x.active, true) }
}

/** The list in use: ops_settings.nurse_services when it holds at least one usable service, else the built-in list. */
export function nurseServices(settings: any): { list: NurseService[]; from: 'settings' | 'built-in'; dropped: number } {
  const raw = settings && Array.isArray(settings.nurse_services) ? settings.nurse_services : null
  if (!raw || !raw.length) return { list: DEFAULT_NURSE_SERVICES.map((s) => ({ ...s, axis: [...s.axis], tasks: [...s.tasks] })), from: 'built-in', dropped: 0 }
  const seen = new Set<string>(), list: NurseService[] = []
  let dropped = 0
  for (const x of raw) { const s = cleanService(x); if (!s || seen.has(s.key)) { dropped++; continue } seen.add(s.key); if (s.active) list.push(s) }
  if (!list.length) return { list: DEFAULT_NURSE_SERVICES.map((s) => ({ ...s })), from: 'built-in', dropped }
  return { list, from: 'settings', dropped }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** a whole-word, case-insensitive hit of one match word on a text */
export function hits(text: unknown, word: string): boolean {
  const t = S(text, 300); if (!t || !word) return false
  return new RegExp('(^|[^A-Za-z0-9])' + esc(word).replace(/\s+/g, '\\s+') + '($|[^A-Za-z0-9])', 'i').test(t)
}
/** the texts of a visit that a match looks at */
export const visitTexts = (v: any): string[] => { const s = (v && v.service) || {}; return [s.code, s.procedureCode, s.description, v && v.serviceCode, v && v.serviceDescription].map((x) => S(x, 300)).filter(Boolean) }
/** does the visit carry the Medicaid nurse visit code T1001 itself? */
export const isT1001 = (v: any): boolean => visitTexts(v).some((t) => hits(t, 'T1001'))

/** The service an AxisCare visit is, or null when it is not a nurse visit. Named services first, the generic one last. */
export function matchService(v: any, list: NurseService[]): NurseService | null {
  if (!v || v.removed) return null
  const texts = visitTexts(v); if (!texts.length) return null
  const ok = (s: NurseService) => s.axis.some((w) => texts.some((t) => hits(t, w)))
  return list.filter((s) => !s.generic).find(ok) || list.filter((s) => s.generic).find(ok) || null
}
