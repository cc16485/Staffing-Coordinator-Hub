// =============================================================================
// step1-sign · the Step 1 page's server (SLICE 2b, Samantha "start slice 2b", 2026-10-10: fictional testing only)
// =============================================================================
// The caregiver's private Step 1 link (applicant-link kind 'step1', an HMAC the Hub made) is the only key to this door.
//   { action: 'view',     o, e, t }                         -> the seven forms (versioned words + fingerprints), what is
//                                                              already answered and signed, the prefill from the offer, the
//                                                              application and the interview, where they left off
//   { action: 'begin',    o, e, t, esign_consent: true }    -> the one-time consent to sign electronically (RSMo 432.230)
//   { action: 'save',     o, e, t, screen, answers }        -> answers merged in (never for a form already signed; never the
//                                                              three locked identity values), and where they are
//   { action: 'identity', o, e, t, ssn, ssn2, dob, license_number, license_state, license_expires }
//                                                           -> sealed with STEP1_KEK into step1_identity; the record keeps
//                                                              only "on file, ending 1234"; refused once the form is signed
//   { action: 'sign',     o, e, t, form, typed_name, consent: true, initials? }
//                                                           -> ONE signature per form, in order, only when every required
//                                                              answer is there; the PDF written once; the trail rows written
//   { action: 'copies',   o, e, t }                         -> short-lived links to the caregiver's own signed PDFs
//   { action: 'open', offer_id, form }  (signed-in staff)   -> a short-lived link to a stored PDF, logged
//   { action: 'screening', offer_id }   (signed-in staff)   -> SLICE 2c: what is on file, the registration facts, may this caller reveal
//   { action: 'reveal', offer_id, field, reason } (screening staff only) -> SLICE 2c: one sealed value, once, for five minutes, logged
// HER RULES BUILT IN: nothing here sends a text or an email; a signed form is never changed (the database trigger and the
// write guard both refuse); the SSN, date of birth and license number never land in answers, logs or the PDF; the test
// gate of Slice 1b holds (only offers on the NEW onboarding path, none real until the switch date); a real applicant signs
// only a form at a version Samantha approved for real (APPROVED_FOR_REAL: all thirteen, approved 2026-10-13, 'approve step 1
// forms', wording page version 5); a form at any other version is refused, and the page says so.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkLink } from '../_shared/applicant-links.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { FORMS, FORM_ORDER, formFingerprint, REFERENCES_REQUIRED, APPROVED_FOR_REAL, approvedAt, approvedForReal, allApprovedForReal, step1Screens, formApplies, applicableForms, DECIDING, formCount, needsCountersign, MATCHING_FACTS, SKILLS, SKILL_GROUPS, step1Ctx, hepbFormAtStart, formsInPlay, HEPB_CHOICE_IDS, type Step1Ctx, type FormKey, type Item, type Form, type Field } from '../_shared/step1-documents.ts'
import { seal, open as unseal, last4, ssnLooksValid, REVEAL_TTL_MS, REVEAL_FIELDS, REVEAL_PERMISSION, type RevealField, ssnAllowed, practiceOffer } from '../_shared/step1-crypto.ts'
import { PERM_KEY, normalizePerms, mayApprove } from '../_shared/onboarding-permissions.ts'
import { step1FormPdf, type IdentityState } from '../_shared/step1-pdf.ts'
import { longDateTime } from '../_shared/offer-documents.ts'
import { practicePerson } from '../_shared/optout.ts'
import { driverFromStep1 } from '../_shared/driver.ts'
import { stepOneRecord, stepOneDeclination, declinationPdf, declinationFingerprint, BUCKET as HEPB_BUCKET, journeyMirror, raiseCard as hepbCard, ownerEmails, publicStatus } from '../_shared/hepb.ts'
import { makeHepbLink } from '../_shared/applicant-links.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n = 120) => String(v ?? '').trim().slice(0, n)
const NOPE = { ok: false, error: 'This link is not valid or has run out. Please ask the office for a new one: (417) 234-8494.' }
export const BUCKET = 'onboarding-documents'
/** 2026-10-13: license and insurance photos (private; driver-compliance.sql) */
export const DRIVER_BUCKET = 'driver-docs'
const PHOTO_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp', pdf: 'application/pdf' }
/** the e-sign consent words on screen 1 (kept in step with step1.html; a change is a new wording) */
export const ESIGN_WORDS = 'I agree to complete and sign my Step 1 paperwork electronically, and I understand my typed name on each form has the same effect as my handwritten signature. I can ask the office for paper copies at any time.'
/* 2026-10-13: from the form list (a form added later gets its screen before All done) */
export const SCREENS = step1Screens()
export const IDENTITY_IDS = ['ssn', 'dob', 'license_number']
const MAP_TABLES = new Set(['windows', 'specialties', 'matching_facts'])
const COLS = 'id,first_name,last_name,phone,email,position,offered_by,onboarding_path,offer_status,offer_signed_at,pd_signed_at,offer_withdrawn_at,offer_declined_at,step1_sent_at,step1_done_at'

function trn() {
  const url = Deno.env.get('OFFERS_PROJECT_URL') ?? '', key = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) throw new Error('the job offers connection is not set up')
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  return {
    // deno-lint-ignore no-explicit-any
    async get(id: string): Promise<any | null> {
      const r = await fetch(`${url}/rest/v1/job_offers?id=eq.${encodeURIComponent(id)}&select=${COLS}`, { headers: H })
      if (!r.ok) throw new Error('the Training Platform answered ' + r.status)
      const rows = await r.json(); return Array.isArray(rows) && rows.length === 1 ? rows[0] : null
    },
    async patch(id: string, body: Record<string, unknown>, guard = ''): Promise<number> {
      const r = await fetch(`${url}/rest/v1/job_offers?id=eq.${encodeURIComponent(id)}${guard}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error('could not save to the offer record (' + r.status + ')')
      const rows = await r.json(); return Array.isArray(rows) ? rows.length : 0
    },
    async event(row: Record<string, unknown>): Promise<void> {
      const r = await fetch(`${url}/rest/v1/offer_events`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row) })
      if (!r.ok) throw new Error('could not write the offer event (' + r.status + ')')
    },
  }
}
const ipOf = (req: Request) => S(req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0], 64)
const agentOf = (req: Request) => S(req.headers.get('user-agent'), 200)
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')

/** The door: the offer must be on the new path, both documents signed, and still open. */
// deno-lint-ignore no-explicit-any
export function dead(o: any): { status: number; body: Record<string, unknown> } | null {
  if (o.onboarding_path !== 'new') return { status: 404, body: { ...NOPE, why: 'not on the new path' } }
  if (o.offer_withdrawn_at || o.offer_declined_at || ['withdrawn', 'declined'].includes(String(o.offer_status))) return { status: 410, body: NOPE }
  if (!o.offer_signed_at || !o.pd_signed_at) return { status: 409, body: { ok: false, error: 'Please sign your offer letter and position description first; Step 1 opens right after.' } }
  return null
}
const itemsOf = (f: Form): Item[] => f.sections.flatMap((s) => s.items || [])
const formOf = (id: string): FormKey | null => { for (const k of FORM_ORDER) if (itemsOf(FORMS[k]).some((i) => i.id === id)) return k; return null }
const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)

/** One answer, cleaned to its kind; undefined = not acceptable. */
export function clean(item: Item, v: unknown): unknown {
  const opts = item.options || []
  switch (item.kind) {
    case 'text': return typeof v === 'string' ? v.trim().slice(0, 1000) : undefined
    case 'number': { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 200 ? n : undefined }
    case 'date': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
    case 'yesno': return v === true || v === 'yes' ? 'yes' : v === false || v === 'no' ? 'no' : undefined
    case 'choice': return typeof v === 'string' && opts.includes(v) ? v : undefined
    case 'initials': return typeof v === 'string' && /^[A-Za-z]{2,4}$/.test(v.trim()) ? v.trim().toUpperCase() : undefined
    case 'multi': return Array.isArray(v) && v.every((x) => typeof x === 'string' && opts.includes(x)) ? [...new Set(v)] : undefined
    case 'table': {
      if (MAP_TABLES.has(item.id)) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
        const out: Record<string, unknown> = {}
        for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
          if (item.id === 'windows') { if (!/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(k) || !c || typeof c !== 'object') return undefined
            const row: Record<string, unknown> = {}; for (const [kk, x] of Object.entries(c as Record<string, unknown>)) { if (!opts.includes(kk)) return undefined; row[kk] = kk === 'Hours (optional)' ? S(x, 80) : x === true } out[k] = row }
          else { if (!opts.includes(k) || !['Yes', 'Not at this time', 'Some experience', 'Lots of experience'].includes(String(c))) return undefined; out[k] = String(c) }
        }
        return out
      }
      if (!Array.isArray(v) || v.length > 20) return undefined
      const rows: string[][] = []
      for (const r of v) { if (!Array.isArray(r) || r.length > opts.length) return undefined; const row = r.map((c) => S(c, 300)); if (row.some(Boolean)) rows.push(row) }
      return rows
    }
    case 'cards': {
      if (!Array.isArray(v) || v.length > (item.max || 10)) return undefined
      const out: Record<string, unknown>[] = []
      for (const r of v) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) return undefined
        const row: Record<string, unknown> = {}
        for (const [k, x] of Object.entries(r as Record<string, unknown>)) {
          const f = (item.fields || []).find((ff) => ff.k === k); if (!f) return undefined
          if (x == null || x === '' || (Array.isArray(x) && !x.length)) continue
          const c = cleanField(f, x); if (c === undefined) return undefined; row[k] = c
        }
        /* a refresher is only for a task ticked on the same card; a lift type only when a lift is ticked */
        const tasks = Array.isArray(row.tasks) ? row.tasks as string[] : []
        if (Array.isArray(row.refresher)) { const rf = (row.refresher as string[]).filter((k) => k === 'none' || tasks.includes(k)); if (rf.includes('none') && rf.length > 1) return undefined; if (rf.length) row.refresher = rf; else delete row.refresher }
        if (!tasks.includes('hoyer_lift')) delete row.lifts
        out.push(row)
      }
      return out
    }
    default: return undefined   // statement, photo: nothing to store in 2b
  }
}
/** One box inside a card, cleaned to its kind; null = empty; undefined = not acceptable. */
export function cleanField(f: Field, v: unknown): unknown {
  const opts = f.options || []
  switch (f.kind) {
    case 'text': return typeof v === 'string' ? v.trim().slice(0, 300) : undefined
    case 'tel': { if (typeof v !== 'string') return undefined; const t = v.trim().slice(0, 30); return /^[0-9()+.\-\s]*$/.test(t) ? t : undefined }
    case 'email': { if (typeof v !== 'string') return undefined; const t = v.trim().slice(0, 160); return t === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : undefined }
    case 'yesno': return v === 'yes' || v === 'no' ? v : undefined
    case 'choice': return typeof v === 'string' && opts.includes(v) ? v : undefined
    case 'multi': case 'lifts': return Array.isArray(v) && v.every((x) => typeof x === 'string' && opts.includes(x)) ? [...new Set(v as string[])] : undefined
    case 'skills': return Array.isArray(v) && v.every((x) => typeof x === 'string' && x in SKILLS) ? [...new Set(v as string[])] : undefined
    case 'refresher': return Array.isArray(v) && v.every((x) => typeof x === 'string' && (x === 'none' || x in SKILLS)) ? [...new Set(v as string[])] : undefined
  }
  return undefined
}
const filled = (x: unknown) => !(x == null || x === '' || (Array.isArray(x) && !x.length))
const cardName = (r: Record<string, unknown>, i: number, what: string) => `${what} ${i + 1}${S(r.name || r.company || r.who, 60) ? ' (' + S(r.name || r.company || r.who, 60) + ')' : ''}`
/** What is still missing on each card: its required boxes, a phone or an email, the tasks when they gave care, a lift type
    when a lift is ticked, an answer to the refresher question, and the contact boxes once a confirmer is named. */
export function cardsMissing(item: Item, rows: unknown, what: string): string[] {
  const out: string[] = []
  ;(Array.isArray(rows) ? rows : []).forEach((raw, i) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, miss: string[] = []
    const has = (k: string) => (item.fields || []).some((f) => f.k === k)
    for (const f of item.fields || []) if (f.required && !filled(r[f.k])) miss.push(f.label.replace(/\s*\(.*\)$/, '').toLowerCase())
    const contactNeeded = item.id !== 'family_care' || filled(r.confirmer)
    if (contactNeeded && has('phone') && !filled(r.phone) && !filled(r.email)) miss.push('a phone or an email')
    if (item.id === 'family_care' && filled(r.confirmer) && !filled(r.may_contact)) miss.push('may we contact them')
    const gaveCare = item.id === 'family_care' || r.did_care === 'yes'
    if (has('tasks') && gaveCare) {
      const tasks = Array.isArray(r.tasks) ? r.tasks as string[] : []
      if (!tasks.length) miss.push('what you did (tick at least one)')
      else { if (tasks.includes('hoyer_lift') && !filled(r.lifts)) miss.push('which kind of lift'); if (!filled(r.refresher)) miss.push('the refresher question') }
    }
    if (miss.length) out.push(cardName(r, i, what) + ': ' + miss.join(', '))
  })
  return out
}
/** A reference counts when it has a name, a phone or an email, and their permission to contact. */
const usableRef = (r: unknown) => { if (Array.isArray(r)) return !!S(r[0]); const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>; return !!S(x.name) && (filled(x.phone) || filled(x.email)) && x.may_contact === 'yes' }
const yes = (a: Record<string, unknown>, id: string) => a[id] === 'yes'
/** Which required answers are still missing on a form, after the conditional rules. */
export function missing(form: FormKey, a: Record<string, unknown>, ident: IdentityState): string[] {
  const f = FORMS[form], out: string[] = []
  const need = (id: string, ok: boolean, label?: string) => { if (!ok) out.push(label || itemsOf(f).find((i) => i.id === id)?.label || id) }
  for (const it of itemsOf(f)) {
    if (!it.required || it.locked || it.kind === 'statement' || it.kind === 'photo') continue
    if (form === 'employee_application' && it.id === 'states_lived') continue
    if (form === 'employee_application' && (it.id === 'employers' || it.id === 'jobs')) continue
    if (form === 'reference_consent' && (it.id === 'professional_refs' || it.id === 'personal_refs')) continue
    if (form === 'vehicle' && it.id === 'insurance_proof' && !yes(a, 'has_insurance')) continue   // no insurance: the proof question does not apply; the driver acknowledgment carries the choice
    if (form === 'edl_fcsr_consent' && ['ssn', 'dob'].includes(it.id)) continue
    need(it.id, !empty(a[it.id]))
  }
  if (form === 'employee_application') {
    if (yes(a, 'lived_outside_mo')) need('states_lived', !empty(a.states_lived))
    if (yes(a, 'moving_violations')) need('moving_violations_detail', !empty(a.moving_violations_detail))
    if (!yes(a, 'no_employer_history')) need('jobs', Array.isArray(a.jobs) && a.jobs.length > 0, 'Your work history (or tick "I have no previous employer to list")')
    const jobs = itemsOf(f).find((i) => i.id === 'jobs'), fam = itemsOf(f).find((i) => i.id === 'family_care')
    if (jobs && !yes(a, 'no_employer_history')) out.push(...cardsMissing(jobs, a.jobs, 'Job'))
    if (fam) out.push(...cardsMissing(fam, a.family_care, 'Family or private-client care'))
  }
  /* 2026-10-13: the criminal-history questions live on the permission form (5a v2); details when they answer yes */
  if (form === 'fcra_disclosure' && yes(a, 'convicted')) need('convictions', !empty(a.convictions))
  if (form === 'reference_consent') {
    /* v3: a reference counts once it has a phone or an email and their permission to contact; each card's own gaps are listed */
    const count = (v: unknown) => (Array.isArray(v) ? v : []).filter(usableRef).length
    const pro = count(a.professional_refs), per = count(a.personal_refs)
    const cardsOf = (id: string) => itemsOf(f).find((i) => i.id === id && i.kind === 'cards')
    for (const [id, what] of [['professional_refs', 'Professional reference'], ['personal_refs', 'Personal reference'], ['backup_refs', 'Backup reference']]) { const it = cardsOf(id); if (it) out.push(...cardsMissing(it, a[id], what)) }
    if (!yes(a, 'no_employer_history')) need('professional_refs', pro >= REFERENCES_REQUIRED.professional, `${REFERENCES_REQUIRED.professional} professional references we may contact (if you would rather we not contact someone, add another person instead)`)
    need('personal_refs', per >= REFERENCES_REQUIRED.personal, `${REFERENCES_REQUIRED.personal} personal references we may contact (if you would rather we not contact someone, add another person instead)`)
  }
  if (form === 'edl_fcsr_consent') { need('ssn', !!ident.ssn, 'Social Security number'); need('dob', ident.dob, 'Date of birth') }
  /* 2026-10-11 (Samantha, station 2: "everything needs to be required"): every day answered (a time or Not available), a shift
     choice, the nights when overnights are chosen; every row of both yes/no grids; the other language when it is chosen. */
  if (form === 'availability') {
    const w = (a.windows && typeof a.windows === 'object' ? a.windows : {}) as Record<string, Record<string, unknown>>
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].filter((d) => !(w[d] && Object.entries(w[d]).some(([k, x]) => k !== 'Hours (optional)' && x === true)))
    need('windows', days.length === 0, days.length === 7 ? 'Your availability for every day (a time, or Not available)' : 'Your availability for ' + days.join(', ') + ' (a time, or Not available)')
    if (Array.isArray(a.shift_prefs) && a.shift_prefs.includes('Overnight shifts')) need('overnight_nights', !empty(a.overnight_nights))
  }
  if (form === 'experience') {
    for (const id of ['specialties', 'matching_facts']) {
      const it = itemsOf(f).find((i) => i.id === id), m = (a[id] && typeof a[id] === 'object' ? a[id] : {}) as Record<string, unknown>
      const left = (it?.options || []).filter((o) => !m[o])
      if (left.length && !empty(a[id])) need(id, false, (it?.label || id) + ': answer every row (' + left.join(', ') + ')')
    }
    if (Array.isArray(a.languages) && a.languages.includes('Another language')) need('languages_other', !empty(a.languages_other))
  }
  /* 2026-10-13: a photo counts once its upload is recorded; the Driver Agreement needs the license number in the locked door */
  for (const it of itemsOf(f)) if (it.kind === 'photo' && it.required) need(it.id, !!(a[it.id] && typeof a[it.id] === 'object' && (a[it.id] as Record<string, unknown>).path))
  if (form === 'vehicle') need('license_number', !!ident.license, "Driver's license number")
  return out
}
// deno-lint-ignore no-explicit-any
const identState = (i: any): IdentityState => ({ ssn: i?.ssn_last4 ? `ending ${i.ssn_last4}` : null, dob: !!i?.dob_sealed, license: i?.license_last4 ? `ending ${i.license_last4}` : null })
// deno-lint-ignore no-explicit-any
function publicSignatures(sigs: any) { const out: Record<string, { at: string; typed_name: string; version: number }> = {}; for (const [k, v] of Object.entries(sigs || {})) { const s = v as Record<string, unknown>; out[k] = { at: String(s.at), typed_name: String(s.typed_name), version: Number(s.version) } } return out }

/** Never ask twice: what the offer, the application and the interview already told us, each marked with its source. */
// deno-lint-ignore no-explicit-any
export function prefillFrom(app: any, interview: any): Record<string, { value: unknown; from: string }> {
  const out: Record<string, { value: unknown; from: string }> = {}
  const yn = (v: unknown) => v === true || v === 'yes' || v === 'Yes' ? 'yes' : v === false || v === 'no' || v === 'No' ? 'no' : null
  if (app) {
    for (const [id, col] of [['lived_outside_mo', 'lived_outside_mo'], ['has_license', 'has_license'], ['has_insurance', 'has_insurance'], ['has_transport', 'has_transport']] as const) { const v = yn(app[col]); if (v) out[id] = { value: v, from: 'your application' } }
    const yrs = Number(app.experience_years); const opts = FORMS.experience.sections.find((s) => s.h === 'Experience')?.items?.[0]?.options || []
    if (Number.isFinite(yrs) && opts.length >= 5) out.experience = { value: opts[yrs <= 0 ? 0 : yrs < 0.5 ? 1 : yrs < 2 ? 2 : yrs < 5 ? 3 : 4], from: 'your application' }
  }
  if (interview) {
    const I = interview, facts: Record<string, string> = {}
    const fact = (id: string, v: unknown) => { const t = v === 'yes' || v === 'outside' ? 'Yes' : v === 'no' ? 'Not at this time' : null; if (t) facts[MATCHING_FACTS.find((m) => m.id === id)?.label || id] = t }
    fact('cats', I.cats); fact('dogs', I.dogs); fact('smoking', I.client_smokes); fact('transportation', I.drive_clients)
    if (Object.keys(facts).length) out.matching_facts = { value: facts, from: 'your interview' }
    const sk = I.skills || {}; const sp: Record<string, string> = {}
    if (sk.dementia && sk.dementia !== 'none') { sp["Alzheimer's disease"] = 'Yes'; sp['Other dementias'] = 'Yes' }
    if (Object.keys(sp).length) out.specialties = { value: sp, from: 'your interview' }
  }
  return out
}

/* ───── SLICE 2d (Samantha "start slice 2d", 2026-10-10): what a signed form lands on the Background & References row ─────
   Through step1_land_apply (server-only, fills blanks, allowed fields only, one history row). The office never retypes a
   reference or a residence answer again. */
const yesno = (v: unknown) => v === 'yes' ? 'yes' : v === 'no' ? 'no' : null
export function landingPatch(form: FormKey, a: Record<string, unknown>, at: string): Record<string, unknown> | null {
  const stamp = { step1_landed: { [form]: at } }
  if (form === 'employee_application') {
    const oos = yesno(a.lived_outside_mo); const p: Record<string, unknown> = { ...stamp }
    if (oos) p.oos = oos
    if (oos === 'yes') p.fp = 'Required'
    if (a.no_employer_history === 'yes') p.no_employer_history = true
    if (Array.isArray(a.states_lived) && a.states_lived.length) (p.step1_landed as Record<string, unknown>).states_lived = a.states_lived
    return p
  }
  if (form === 'reference_consent') {
    const p: Record<string, unknown> = { ...stamp }; let n = 0
    /* v3 (2026-10-11): cards become the same five columns; a reference they asked us not to contact never lands */
    const rows = (v: unknown, pro: boolean) => (Array.isArray(v) ? v : []).flatMap((r: unknown) => {
      if (Array.isArray(r)) return [r.map((c) => S(c, 160))]
      const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
      if (x.may_contact === 'no') return []
      return [pro ? [S(x.name), S(x.company), S(x.role), S(x.phone), S(x.email)] : [S(x.name), S(x.relationship), S(x.phone), S(x.email)]]
    }) as string[][]
    for (const r of rows(a.professional_refs, true)) { if (n >= 4 || !S(r[0])) continue; n++; Object.assign(p, { [`r${n}n`]: S(r[0], 80), [`r${n}_company`]: S(r[1], 80), [`r${n}_rel`]: S(r[2], 80), [`r${n}_phone`]: S(r[3], 30), [`r${n}_email`]: S(r[4], 160), [`r${n}_type`]: 'professional', [`r${n}s`]: 'Pending' }) }
    for (const r of rows(a.personal_refs, false)) { if (n >= 4 || !S(r[0])) continue; n++; Object.assign(p, { [`r${n}n`]: S(r[0], 80), [`r${n}_rel`]: S(r[1], 80), [`r${n}_phone`]: S(r[2], 30), [`r${n}_email`]: S(r[3], 160), [`r${n}_type`]: 'personal', [`r${n}s`]: 'Pending' }) }
    ;(p.step1_landed as Record<string, unknown>).references = n
    return n ? p : null
  }
  return null
}
// deno-lint-ignore no-explicit-any
async function land(db: any, offerId: string, patch: Record<string, unknown> | null, by: string): Promise<Record<string, unknown>> {
  if (!patch) return { skipped: true }
  try { const { data, error } = await db.rpc('step1_land_apply', { p_offer_id: offerId, p_patch: patch, p_by: by }); return error ? { ok: false, error: String(error.message || error).slice(0, 160) } : (data ?? { ok: false }) }
  catch (e) { return { ok: false, error: String((e as Error).message || e).slice(0, 160) } }
}

/** 2026-10-13 (her rule: no silent failures): one Needs Attention card per id for Recruiting & Orientation; never raised twice.
    Returns the card id, or 'not raised' when even the card could not be written (the trail event still records it). */
// deno-lint-ignore no-explicit-any
async function problemCard(db: any, id: string, item: Record<string, unknown>, urgency = 'now'): Promise<string> {
  try {
    const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    // deno-lint-ignore no-explicit-any
    if ((Array.isArray(row?.data) ? row.data : []).some((x: any) => x && x.id === id)) return id
    const now = new Date().toISOString()
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id, domain: 'recruiting_orientation', status: 'open', urgency, created_at: now, first_at: now, last_at: now,
      due: now, created_by: 'step1-sign', opened_by: 'step1-sign', ...item } })
    return error ? 'not raised' : id
  } catch { return 'not raised' }
}

/** closes one Needs Attention card (when its work is done); never throws */
// deno-lint-ignore no-explicit-any
async function closeCard(db: any, id: string, by: string, done: boolean): Promise<void> {
  if (!done) return
  try {
    const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const c = (Array.isArray(row?.data) ? row.data : []).find((x: any) => x && x.id === id)
    if (c && c.status !== 'done') await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...c, status: 'done', closed_at: new Date().toISOString(), closed_by: by, close_note: 'Signed for Caring Companions' } })
  } catch { /* the card stays open; the readiness row shows it is signed */ }
}

/* 2026-10-13 (her rule 2026-10-08: the signed Step 1 PDFs stay in the Hub's private store and are LINKED from the person's
   GoHighLevel contact: a note and a link, never the PDF in GoHighLevel). One note when Step 1 completes; the link opens only
   for signed-in office staff. A practice or training hire is never put into GoHighLevel. A note that cannot be written
   becomes a card (never silent). Never throws; never messages anyone. */
// deno-lint-ignore no-explicit-any
export async function ghlStep1Note(db: any, o: any, who: Record<string, string>, offerId: string, at: string): Promise<Record<string, unknown>> {
  if (practiceOffer(o) || practicePerson(who.phone, who.email)) return { skipped: 'practice' }
  const token = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', loc = Deno.env.get('GHL_LOCATION_ID') || ''
  const name = `${who.first} ${who.last}`.trim()
  const fail = async (why: string) => ({ ok: false, why, card: await problemCard(db, 's1ghl_' + offerId, { kind: 'step1_ghl_note_failed', who: name, offer_id: offerId,
    title: 'Step 1 link not added to GoHighLevel: ' + name, detail: 'Step 1 is complete and every signed form is safe on their Hub profile, but the note linking them on their GoHighLevel contact could not be written (' + why + '). Nothing else is affected.' }, 'week') })
  if (!token || !loc) return await fail('GoHighLevel is not configured on this project')
  const H: Record<string, string> = { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json', 'Content-Type': 'application/json' }
  try {
    const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', { method: 'POST', headers: H,
      body: JSON.stringify({ locationId: loc, email: who.email || undefined, phone: who.phone || undefined, firstName: who.first || undefined, lastName: who.last || undefined }) })
    const ud = await up.json().catch(() => null), cid = String(ud?.contact?.id || ud?.id || '')
    if (!up.ok || !cid) return await fail('their contact could not be found (' + up.status + ')')
    const body = `Step 1 complete ${longDateTime(at)}: all of their signed Step 1 forms are kept in the Hub. Office staff: https://cc.mo-care.com/step1.html?review=${offerId}`
    const nr = await fetch(`https://services.leadconnectorhq.com/contacts/${cid}/notes`, { method: 'POST', headers: H, body: JSON.stringify({ body }) })
    if (!nr.ok) return await fail('the note was refused (' + nr.status + ')')
    return { ok: true, contact_id: cid }
  } catch (e) { return await fail(String((e as Error).message || e).slice(0, 120)) }
}

/* ───── STEP 1 BEFORE CHECKS (Samantha 2026-10-11, "yes to all") ─────
   Step 1 complete: the server puts them into Background & References (step1_candidate_create: the record is made, or an
   unlinked record with the same phone or name is linked, never two), records it on the readiness card, and raises ONE
   Needs Attention card for whoever owns Recruiting & Orientation on the Admin page: start the checks and references now
   that their signed permission is in. Never throws; what it did comes back for the trail. */
// deno-lint-ignore no-explicit-any
async function enterChecks(db: any, offerId: string, who: Record<string, string>, o: any, at: string): Promise<Record<string, unknown>> {
  const name = `${who.first} ${who.last}`.trim() || 'a new hire'
  const record = { first: who.first, last: who.last, phone: who.phone, email: who.email, oos: '', fp: 'N/A', oig: 'Pending', edl: 'Pending', fcsr: 'Pending',
    r1s: 'Pending', r2s: 'Pending', r3s: 'Pending', r4s: 'Pending', onboarding_path: 'new', position: who.position || 'Caregiver',
    notes: 'Into Background & References when their Step 1 was complete' + (o?.offered_by ? ' (offer by ' + S(o.offered_by, 60) + ')' : '') + '.',
    invite_sent: false, invite_sent_date: '', addedAt: at, added_by: 'Step 1 complete (the Hub)' }
  let made: Record<string, unknown> = { ok: false }
  try { const { data, error } = await db.rpc('step1_candidate_create', { p_offer_id: offerId, p_record: record }); made = error ? { ok: false, error: String(error.message || error).slice(0, 160) } : (data ?? { ok: false }) }
  catch (e) { made = { ok: false, error: String((e as Error).message || e).slice(0, 160) } }
  try {
    const { data: j } = await db.from('client_journey').select('journey_id').eq('subject', 'caregiver').eq('offer_id', offerId).neq('status', 'closed').maybeSingle()
    if (j?.journey_id) await db.from('client_journey_event').insert({ journey_id: j.journey_id, actor_email: 'hub', actor_name: 'The Hub', kind: 'step1_complete',
      detail: { at, background_and_references: made.how || (made.ok ? 'in' : 'failed'), candidate_id: made.id ?? null }, reason: 'Step 1 complete: their signed permission is in' })
  } catch { /* the trail on the offer still has step1_done */ }
  if (made.ok !== true) {
    /* 2026-10-13: Step 1 is complete but they did not reach Background & References: never silent */
    made.card = await problemCard(db, 's1land_' + offerId, { kind: 'step1_landing_failed', who: name, offer_id: offerId,
      title: 'Step 1 is complete but did not reach Background & References: ' + name,
      detail: name + ' signed every Step 1 form, but the Hub could not put them into Background & References (' + S(made.error || made.reason || 'no reason given', 160) + '). Their signed forms are safe on their profile. Add them to Background & References by hand, or tell Claude, so the checks and references can start.' })
    return made
  }
  try {
    let owner = { email: '', name: '' }
    try {
      const { data: d } = await db.from('domains').select('owner_person').eq('entity', 'cc_ihs').eq('code', 'recruiting_orientation').maybeSingle()
      if (d?.owner_person) { const { data: p } = await db.from('persons').select('full_name, primary_email').eq('person_id', d.owner_person).maybeSingle(); if (p?.primary_email) owner = { email: String(p.primary_email).toLowerCase(), name: S(p.full_name, 80) } }
    } catch { /* unowned: the card still shows on Needs Attention */ }
    const now = new Date().toISOString(), cid = 's1done_' + offerId
    const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    // deno-lint-ignore no-explicit-any
    if (!(Array.isArray(row?.data) ? row.data : []).some((x: any) => x && x.id === cid)) {
      await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: cid, kind: 'step1_complete', domain: 'recruiting_orientation', status: 'open', urgency: 'today',
        /* TRAINING WALKTHROUGH (2026-10-11): a staff member trying the journey on their own phone; the card says so */
        title: (/\(TRAINING\)/.test(name) ? 'TRAINING: ' : '') + 'Step 1 complete: start background checks and references for ' + name,
        detail: (/\(TRAINING\)/.test(name) ? 'A staff training walkthrough (made-up identity): try the checks if you like; nothing real is needed. ' : '') + name + ' signed every Step 1 form, including the reference consent and the permission for background checks. They are now in Background & References: run the checks and contact the references.',
        who: name, offer_id: offerId, candidate_id: made.id ?? null, owner: owner.email, owner_name: owner.name, created_at: now, first_at: now, last_at: now,
        due: new Date(Date.now() + 24 * 3_600_000).toISOString(), created_by: 'step1-sign', opened_by: 'step1-sign' } })
      made.card = cid
    }
  } catch { made.card = 'not raised' }
  return made
}

/** never ask twice: their application (by email, then by phone) with its interview answers; null when none or unreadable */
// deno-lint-ignore no-explicit-any
export async function applicationOf(db: any, who: { email: string; phone: string }): Promise<any> {
  try {
    if (who.email) { const r = await db.from('job_applicants').select('*').ilike('email', who.email).order('created_at', { ascending: false }).limit(1); if (r.data?.[0]) return r.data[0] }
    if (digits(who.phone).length >= 10) { const r = await db.from('job_applicants').select('*').ilike('phone', '%' + digits(who.phone).slice(-4)).order('created_at', { ascending: false }).limit(20); return (r.data ?? []).find((x: { phone?: string }) => digits(x.phone).slice(-10) === digits(who.phone).slice(-10)) ?? null }
  } catch { return null }
  return null
}
export const PREVIEW_WHO = { first: 'Pat', last: 'Preview', phone: '(417) 555-0188', email: 'pat.preview@practice.invalid', position: 'Caregiver' }
/** What a real Step 1 would show as already known: from a made-up application and interview, marked with where it came from. */
export const PREVIEW_PREFILL = prefillFrom({ lived_outside_mo: 'no', has_license: 'yes', has_insurance: 'yes', has_transport: 'yes', experience_years: 3 }, { cats: 'yes', dogs: 'no', client_smokes: 'no', drive_clients: 'yes', skills: { dementia: 'some' } })
/** The forms as the page receives them (the same shape the real view sends). */
export async function formsPayload(sigs: Record<string, unknown> = {}, ctx: Step1Ctx = {}): Promise<Record<string, unknown>[]> {
  const forms = [] as Record<string, unknown>[]
  /* 2026-10-13: only the forms in this person's Step 1 (the Hepatitis B form only when their Step 1 has it) */
  for (const k of formsInPlay(ctx)) { const f = FORMS[k]; forms.push({ key: f.key, screen: f.screen, title: f.title, short: f.short || null, layout: f.layout || null, when: f.when || null, confidential: !!f.confidential, choices: f.choices || null, decline: f.decline || null, version: f.version, status: f.status, intro: f.intro || [], sections: f.sections, certification: f.certification, signature: f.signature, fingerprint: await formFingerprint(k), approved_for_real: APPROVED_FOR_REAL[k] === f.version }) }
  void sigs
  return forms
}
/** 2026-10-13: the preview shows the Step 1 a new hire gets once the Hepatitis B form is approved (offered to everyone) */
export const PREVIEW_CTX: Step1Ctx = { hepb: true }
const PREVIEW_ORDER = formsInPlay(PREVIEW_CTX)
/** 2026-10-13: what the one deciding choice still needs (the Hepatitis B form): a choice; for a declination, the separate
    agreement to sign the Appendix A statement */
export function choiceMissing(form: FormKey, choice: unknown, declineConsent: unknown): string[] {
  const f = FORMS[form]; if (!f?.choices) return []
  const c = S(choice, 20)
  if (!f.choices.options.some((o) => o.id === c)) return [f.choices.label + ' (choose one)']
  if (f.decline && c === f.decline.choice && declineConsent !== true) return ['Tick "' + f.decline.consent + '"']
  return []
}
/** Answers from the page, each cleaned to its kind (unknown ids and identity numbers dropped, never kept). */
function cleanAnswers(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (IDENTITY_IDS.includes(k)) continue
    if (k === 'initials') { const c = clean({ id: 'initials', label: '', kind: 'initials' }, v); if (c !== undefined) out.initials = c; continue }
    if (DECIDING[k]) { if (DECIDING[k].options.some(([x]) => x === v)) out[k] = v; continue }
    const fk = formOf(k); if (!fk) continue
    const item = itemsOf(FORMS[fk]).find((i) => i.id === k)!; const c = clean(item, v); if (c !== undefined) out[k] = c
  }
  return out
}
// deno-lint-ignore no-explicit-any
export async function preview(b: Record<string, any>): Promise<Record<string, unknown>> {
  const form = S(b.form, 40) as FormKey, answers = cleanAnswers(b.answers)
  /* 2026-10-13: the preview's practice pictures (never uploaded) count as given, so the driver path can be tried */
  for (const k of FORM_ORDER) for (const it of itemsOf(FORMS[k])) if (it.kind === 'photo') { const v = (b.answers || {})[it.id]; if (v && typeof v === 'object' && /^preview\//.test(String(v.path || ''))) answers[it.id] = { path: String(v.path).slice(0, 80) } }
  const id = b.identity && typeof b.identity === 'object' ? b.identity : {}
  const ident: IdentityState = { ssn: id.ssn ? 'ending ' + S(id.ssn, 4) : null, dob: !!id.dob, license: id.license ? 'ending ' + S(id.license, 4) : null }
  /* 2026-10-13 (705, the go-live proof): would a REAL applicant be allowed to sign these forms at these versions? Read only:
     the same rule the sign action uses (approved at exactly that version, and that version is the wording in force). */
  if (Array.isArray(b.approval_check)) {
    const out = (b.approval_check as unknown[]).slice(0, 40).map((x) => {
      const k = S((x as Record<string, unknown>)?.form, 40) as FormKey, v = (x as Record<string, unknown>)?.version
      const known = FORM_ORDER.includes(k)
      return { form: k, version: typeof v === 'number' ? v : null, current: known ? FORMS[k].version : null, accepted: known && FORMS[k].version === v && approvedAt(k, v) }
    })
    return { ok: true, preview: true, approval_check: out }
  }
  if (b.check || b.pdf) {
    if (!FORM_ORDER.includes(form)) return { ok: false, error: 'Which form?' }
    /* 2026-10-13: the Hepatitis B choice is checked like the real sign does; it lives in the page only (never an answer) */
    if (b.check) return { ok: true, preview: true, form, missing: [...missing(form, answers, ident), ...choiceMissing(form, b.choice, b.decline_consent)] }
    const at = new Date().toISOString(), i = PREVIEW_ORDER.indexOf(form)
    if (FORMS[form].choices && HEPB_CHOICE_IDS.includes(S(b.choice, 20))) answers.__choice = S(b.choice, 20)
    const bytes = step1FormPdf(FORMS[form], answers, PREVIEW_WHO, ident, { typedName: 'Pat Preview (PREVIEW ONLY: not a signed document)', signedAtCentral: 'Preview, ' + longDateTime(at), signedAtUtc: at, ip: 'preview', agent: 'preview', version: FORMS[form].version, fingerprint: await formFingerprint(form), offerId: 'preview (no offer)', docName: FORMS[form].title }, i + 1, PREVIEW_ORDER.length)
    let bin = ''; for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000))
    return { ok: true, preview: true, form, pdf_base64: btoa(bin) }
  }
  return { ok: true, preview: true, who: PREVIEW_WHO, forms: await formsPayload({}, PREVIEW_CTX), order: PREVIEW_ORDER, screens: step1Screens(PREVIEW_CTX), answers: {}, signatures: {}, identity: { ssn: null, dob: false, license: null, license_state: null, license_expires: null },
    prefill: PREVIEW_PREFILL, hints: { availability: 'Weekdays, mornings and afternoons', travel: 'Springfield and Nixa' }, current_screen: '1', started_at: null, completed_at: null, esign_consent_at: null,
    test_mode: true, references_required: REFERENCES_REQUIRED, skill_groups: SKILL_GROUPS, skills: SKILLS, signed_count: 0, form_count: formCount({}, PREVIEW_CTX), deciding: DECIDING }
}

/* 2026-10-13 HEPATITIS B IN STEP 1, after the signature is written: the signed form's PDF (and, for a declination, the
   Appendix A statement as its own PDF, the same layout the hepatitis B link makes) into the PRIVATE hepb-docs store, written
   once; the readiness row (status words only); one card for the owners to check an exception (no medical detail on it).
   A file that cannot be saved becomes a card for the owners (never silent). Never throws. */
// deno-lint-ignore no-explicit-any
export async function hepbAfterSign(db: any, req: Request, row: any, x: { who: Record<string, string>; choice: string; name: string; at: string; ip: string; agent: string; bytes: Uint8Array; offerId: string }): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { pdf: false }
  try {
    const stamp = x.at.replace(/[:.]/g, '-'), person = `${x.who.first} ${x.who.last}`.trim()
    const owner = (await ownerEmails(db))[0] || ''
    const fail = async (what: string, why: string) => { await hepbCard(db, { id: 'hepb_pdf_' + row.id + '_' + what, kind: 'hepb_pdf_failed', urgency: 'today', who: person, hepb_id: row.id, offer_id: x.offerId, owner,
      title: 'A signed hepatitis B form has no PDF yet: ' + person, detail: `The Step 1 signature is recorded (time, device, wording fingerprint), but its PDF could not be saved (${S(why, 120)}). Tell Claude so the PDF is made again from the signed record.` }) }
    if (!row.step1_pdf) {
      const path = `hb/${row.id}/step1/v${FORMS.hepb_vaccination.version}-${stamp}.pdf`
      const up = await db.storage.from(HEPB_BUCKET).upload(path, x.bytes, { contentType: 'application/pdf', upsert: false })
      if (up.error) await fail('step1', String(up.error.message || up.error))
      else { await db.from('hepb_record').update({ step1_pdf: path }).eq('id', row.id).is('step1_pdf', null); row = { ...row, step1_pdf: path } }
    }
    out.pdf = !!row.step1_pdf; out.path = row.step1_pdf || null
    if (x.choice === 'declined' && !row.declined_at) {
      const dfp = await declinationFingerprint()
      const dbytes = declinationPdf({ first: x.who.first, last: x.who.last, position: x.who.position }, { typedName: x.name, signedAtCentral: longDateTime(x.at), signedAtUtc: x.at, ip: x.ip, agent: x.agent, fingerprint: dfp, recordId: row.id }, 'the Step 1 page, after the hepatitis B vaccine information')
      const dpath = `hb/${row.id}/declination/v1-${stamp}.pdf`
      const up = await db.storage.from(HEPB_BUCKET).upload(dpath, dbytes, { contentType: 'application/pdf', upsert: false })
      if (up.error) await fail('declination', String(up.error.message || up.error))
      row = await stepOneDeclination(db, row, { typedName: x.name, at: x.at, ip: x.ip, agent: x.agent, fingerprint: dfp, pdf: up.error ? null : dpath })
    }
    out.journey = await journeyMirror(db, row, { name: person + ' (Step 1)' })
    if (['prior_series', 'immune', 'contraindicated'].includes(x.choice)) {
      await hepbCard(db, { id: `hepb_check_${row.id}_step1`, kind: 'hepb_check', urgency: 'normal', who: person, hepb_id: row.id, offer_id: x.offerId, owner,
        title: `Check a hepatitis B answer: ${person}`, detail: `${person} answered the hepatitis B vaccine offer in Step 1. An owner opens their Hepatitis B card, checks it, and presses Checked. The answer is a confidential medical record, so it is not written here.` })
      if (x.choice !== 'contraindicated') out.proof_link = await makeHepbLink(Deno.env.get('HUB_JOB_SECRET') ?? '', String(row.id))
    }
    void req
  } catch (e) { out.error = S((e as Error)?.message ?? e, 160) }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const secret = Deno.env.get('HUB_JOB_SECRET') ?? '', kek = Deno.env.get('STEP1_KEK') ?? ''
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  // deno-lint-ignore no-explicit-any
  const b: Record<string, any> = await req.json().catch(() => ({}))
  const action = S(b.action, 20)
  try {
    if (action === 'open') {
      const staff = await requireStaff(db, req, OFFICE_ROLES)
      if (!staff.ok) return json({ ok: false, error: staff.error }, staff.status)
      const id = S(b.offer_id, 64), form = S(b.form, 40)
      /* 2026-10-13: the signed Hepatitis B form is a confidential medical record: it is opened only by an owner, from the Hepatitis B card */
      if (FORMS[form as FormKey]?.confidential) return json({ ok: false, error: 'This form is a confidential medical record. An owner opens it from their Hepatitis B card.', confidential: true }, 403)
      const { data: row } = await db.from('step1_forms').select('pdfs').eq('offer_id', id).maybeSingle()
      const path = row?.pdfs?.[form]
      if (!path) return json({ ok: false, error: 'That form has not been signed yet.' }, 404)
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 300)
      if (error || !data?.signedUrl) return json({ ok: false, error: 'Could not open the document.' }, 500)
      await db.from('document_access_log').insert({ offer_id: id, doc: 'step1:' + form, path, by_person: staff.person_id, by_email: staff.email, by_name: staff.name, ip: ipOf(req) })
      return json({ ok: true, url: data.signedUrl, expires_in: 300 })
    }
    /* ───── SLICE 2c (Samantha "start slice 2c", 2026-10-10): the screening desk and the identity reveal ─────
       Office staff by their own sign-in. `screening` tells the desk what is on file and whether this caller may reveal;
       `reveal` opens ONE sealed field for a person on the Admin page's Screening staff list (decision 6), with a reason,
       for REVEAL_TTL_MS; the log row, the reveal count and the trail row are written, the value is in none of them. */
    if (action === 'screening' || action === 'reveal') {
      const staff = await requireStaff(db, req, OFFICE_ROLES)
      if (!staff.ok) return json({ ok: false, error: staff.error }, staff.status)
      const oid = S(b.offer_id, 64)
      if (!/^[0-9a-f-]{8,64}$/i.test(oid)) return json({ ok: false, error: 'Which offer?' }, 400)
      const { data: permRow } = await db.from('app_data').select('data').eq('key', PERM_KEY).maybeSingle()
      const perms = normalizePerms(permRow?.data)
      const mayReveal = mayApprove(perms, REVEAL_PERMISSION, { person_id: staff.person_id, roles: staff.roles, email: staff.email })
      const { data: idr } = await db.from('step1_identity').select('ssn_last4,dob_sealed,ssn_sealed,license_sealed,license_last4,license_state,license_expires,address1,address2,city,state,zip,captured_at,purge_after,purged_at,reveals').eq('offer_id', oid).maybeSingle()
      if (action === 'screening') {
        const o = await trn().get(oid)
        const { data: fr } = await db.from('step1_forms').select('answers,signatures,completed_at').eq('offer_id', oid).maybeSingle()
        const { data: log } = await db.from('document_access_log').select('at,doc,by_name,by_email,reason').eq('offer_id', oid).like('doc', 'identity:%').order('at', { ascending: false }).limit(10)
        const a = (fr?.answers || {}) as Record<string, unknown>
        return json({ ok: true, may_reveal: mayReveal, ttl_seconds: REVEAL_TTL_MS / 1000, fields: REVEAL_FIELDS,
          identity: idr ? { ...identState(idr), license_state: idr.license_state, license_expires: idr.license_expires, captured_at: idr.captured_at, reveals: idr.reveals, purged_at: idr.purged_at, purge_after: idr.purge_after } : null,
          facts: { first: S(o?.first_name, 60), last: S(o?.last_name, 60), phone: S(o?.phone, 30), email: S(o?.email, 160), preferred_name: S(a.preferred_name, 80), other_names: S(a.other_names, 200),
            lived_outside_mo: a.lived_outside_mo ?? null, states_lived: Array.isArray(a.states_lived) ? a.states_lived : [], address: [a.address1, a.address2, [a.city, a.state, a.zip].filter(Boolean).join(' ')].map((x) => S(x, 120)).filter(Boolean).join(', '),
            /* 2026-10-14 (5b v5): the facts the state's FCSR forms ask for, for the Hub's FCSR sheet. A Step 1 signed before
               v5 never had these questions: each is '' and the sheet says "not collected". */
            middle_name: S(a.middle_name, 60), suffix: S(a.suffix, 10), birth_name: S(a.birth_name, 120), gender: S(a.gender, 10), county: S(a.county, 60) },
          consent_signed_at: (fr?.signatures as Record<string, { at?: string }> | undefined)?.edl_fcsr_consent?.at ?? null, step1_completed_at: fr?.completed_at ?? null, reveals_log: log ?? [] })
      }
      // reveal
      if (!mayReveal) return json({ ok: false, error: 'Only a person named on the Admin page\'s Screening staff list may reveal identity details. Ask an owner to add you there.' }, 403)
      const field = S(b.field, 10) as RevealField
      if (!REVEAL_FIELDS.includes(field)) return json({ ok: false, error: 'Which field: ssn, dob or license?' }, 400)
      const reason = S(b.reason, 200)
      if (reason.length < 5) return json({ ok: false, error: 'Please say why (at least five characters): for example "FCSR registration" or "EDL check".' }, 400)
      if (!idr) return json({ ok: false, error: 'Nothing is on file for this offer yet.' }, 404)
      if (idr.purged_at) return json({ ok: false, error: 'These details were purged on ' + String(idr.purged_at).slice(0, 10) + '.' }, 410)
      const sealed = field === 'ssn' ? idr.ssn_sealed : field === 'dob' ? idr.dob_sealed : idr.license_sealed
      if (!sealed) return json({ ok: false, error: 'That detail is not on file yet.' }, 404)
      if (kek.length < 40) return json({ ok: false, error: 'The lock is not set up on the server.' }, 500)
      let value = ''
      try { value = await unseal(kek, oid, sealed) } catch { return json({ ok: false, error: 'The sealed value could not be opened. Tell Claude.' }, 500) }
      const at = new Date().toISOString()
      const { error: lErr } = await db.from('document_access_log').insert({ offer_id: oid, doc: 'identity:' + field, path: '(sealed; revealed for ' + (REVEAL_TTL_MS / 60000) + ' minutes)', by_person: staff.person_id, by_email: staff.email, by_name: staff.name, ip: ipOf(req), reason })
      if (lErr) return json({ ok: false, error: 'The reveal could not be logged, so nothing is shown.' }, 500)
      await db.from('step1_identity').update({ reveals: Number(idr.reveals || 0) + 1, updated_at: at }).eq('offer_id', oid)
      try { await trn().event({ offer_id: oid, kind: 'identity_revealed', by_who: 'staff', channel: 'hub', detail: { field, by_name: staff.name, by_email: staff.email, reason } }) } catch { /* the log row is the record; the trail is a courtesy */ }
      return json({ ok: true, field, value, revealed_at: at, expires_in: REVEAL_TTL_MS / 1000, by: staff.name })
    }
    /* ───── COMPANY SIGNATURE (2026-10-13): a form marked countersign (the Employment Agreement) is signed for Caring Companions,
       after the applicant signs it, by a person on the Approve to Work list, from the Hub (their Step 1 screens). Write once;
       the applicant's own signed PDF is never replaced: a second PDF carries both signatures. ───── */
    if (action === 'countersign') {
      const staff = await requireStaff(db, req, OFFICE_ROLES)
      if (!staff.ok) return json({ ok: false, error: staff.error }, staff.status)
      const oid = S(b.offer_id, 64), form = S(b.form, 40) as FormKey
      if (!/^[0-9a-f-]{36}$/i.test(oid) || !FORM_ORDER.includes(form) || !FORMS[form].countersign) return json({ ok: false, error: 'Which agreement?' }, 400)
      const { data: permRow } = await db.from('app_data').select('data').eq('key', PERM_KEY).maybeSingle()
      if (!mayApprove(normalizePerms(permRow?.data), 'work', { person_id: staff.person_id, roles: staff.roles, email: staff.email })) return json({ ok: false, error: 'Only a person on the Approve to Work list can sign for Caring Companions.' }, 403)
      if (b.consent !== true) return json({ ok: false, error: 'Please tick that you are signing for Caring Companions first.' }, 400)
      const name = S(b.typed_name, 80); if (!/^\S+(\s+\S+)+$/.test(name)) return json({ ok: false, error: 'Please type your full name, first and last.' }, 400)
      const { data: fr } = await db.from('step1_forms').select('*').eq('offer_id', oid).maybeSingle()
      const es = (fr?.signatures || {})[form] as Record<string, unknown> | undefined
      if (!es) return json({ ok: false, error: 'They have not signed it yet. The company signs after them.' }, 409)
      if ((fr?.countersignatures || {})[form]) return json({ ok: false, error: 'It is already signed for Caring Companions. A signature is never changed.', already: true }, 409)
      if (Number(es.version) !== FORMS[form].version) return json({ ok: false, error: `They signed version ${es.version} and the wording is now version ${FORMS[form].version}. Tell Claude: the company signs the same version they signed.` }, 409)
      const o = await trn().get(oid); if (!o) return json({ ok: false, error: 'That offer was not found.' }, 404)
      const rwho = { first: S(o.first_name, 60), last: S(o.last_name, 60), phone: S(o.phone, 30), email: S(o.email, 160), position: S(o.position, 80) || 'Caregiver' }
      const { data: idr } = await db.from('step1_identity').select('ssn_last4,dob_sealed,license_last4').eq('offer_id', oid).maybeSingle()
      const at = new Date().toISOString(), cs = { at, typed_name: name, by_name: staff.name, by_email: staff.email, by_person: staff.person_id, ip: ipOf(req), agent: agentOf(req), version: es.version, fingerprint: es.fingerprint }
      const { data: wrote, error: wErr } = await db.from('step1_forms').update({ countersignatures: { ...(fr.countersignatures || {}), [form]: cs } }).eq('offer_id', oid).filter('countersignatures->' + form, 'is', null).select('offer_id')
      if (wErr || !wrote?.length) return json({ ok: false, error: 'It was just signed for Caring Companions. A signature is never changed.', already: true }, 409)
      const T = trn(); await T.event({ offer_id: oid, kind: 'step1_signed', by_who: 'staff', channel: 'hub', result: 'countersigned', doc_version: Number(es.version), fingerprint: String(es.fingerprint), detail: { form, typed_name: name, by_name: staff.name, by_email: staff.email, ip: ipOf(req), signed_at: at } })
      const bytes = step1FormPdf(FORMS[form], (fr.answers || {}) as Record<string, unknown>, rwho, identState(idr),
        { typedName: String(es.typed_name), signedAtCentral: longDateTime(String(es.at)), signedAtUtc: String(es.at), ip: String(es.ip || ''), agent: String(es.agent || ''), version: Number(es.version), fingerprint: String(es.fingerprint), offerId: oid, docName: FORMS[form].title },
        FORM_ORDER.indexOf(form) + 1, FORM_ORDER.length,
        { typedName: name, signedAtCentral: longDateTime(at), signedAtUtc: at, ip: ipOf(req), agent: agentOf(req), version: Number(es.version), fingerprint: String(es.fingerprint), offerId: oid, docName: FORMS[form].title, byEmail: staff.email })
      const path = `step1/${oid}/${form}-v${es.version}-countersigned-${at.replace(/[:.]/g, '-')}.pdf`
      const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
      if (up.error) { await problemCard(db, 's1cspdf_' + oid + '_' + form, { kind: 'step1_pdf_failed', offer_id: oid, title: 'The company-signed PDF was not saved: ' + `${rwho.first} ${rwho.last}`.trim(), detail: 'The company signature on ' + FORMS[form].title + ' is recorded, but its PDF could not be saved. Tell Claude so it is made again from the record.' }) }
      else await db.from('step1_forms').update({ countersigned_pdfs: { ...(fr.countersigned_pdfs || {}), [form]: path } }).eq('offer_id', oid).filter('countersigned_pdfs->' + form, 'is', null)
      await closeCard(db, 's1cs_' + oid, staff.name, needsCountersign(fr.signatures || {}, { ...(fr.countersignatures || {}), [form]: cs }).length === 0)
      return json({ ok: true, form, countersigned_at: at, by: staff.name, pdf: !up.error })
    }
    /* ───── REVIEW (Samantha 2026-10-13: "show every Step 1 screen ... along with the applicant's answers ... coordinators
       see the complete journey without jumping between systems"). Office staff by their own sign-in, READ ONLY: the same
       screens the applicant saw, their answers, every signature with its time, device and wording version. Identity numbers
       stay sealed ("on file, ending"). Every look is logged. Nothing is saved, signed or sent. ───── */
    if (action === 'review') {
      const staff = await requireStaff(db, req, OFFICE_ROLES)
      if (!staff.ok) return json({ ok: false, error: staff.error }, staff.status)
      const oid = S(b.offer_id, 64)
      if (!/^[0-9a-f-]{36}$/i.test(oid)) return json({ ok: false, error: 'Which offer?' }, 400)
      const o = await trn().get(oid); if (!o) return json({ ok: false, error: 'That offer was not found.' }, 404)
      const rwho = { first: S(o.first_name, 60), last: S(o.last_name, 60), phone: S(o.phone, 30), email: S(o.email, 160), position: S(o.position, 80) || 'Caregiver' }
      const { data: fr } = await db.from('step1_forms').select('*').eq('offer_id', oid).maybeSingle()
      const { data: idr } = await db.from('step1_identity').select('ssn_last4,dob_sealed,license_last4,license_state,license_expires').eq('offer_id', oid).maybeSingle()
      const app = await applicationOf(db, rwho)
      const rctx = step1Ctx(fr)
      /* 2026-10-13: the Hepatitis B answer is never shown here, only the status words everyone in the office may see */
      let hepbStatus: string | null = null
      if (rctx.hepb) { try { const { data: hr } = await db.from('hepb_record').select('status, offered_at, verified_at').eq('offer_id', oid).maybeSingle(); hepbStatus = publicStatus(hr) } catch { hepbStatus = null } }
      const rsigs = (fr?.signatures || {}) as Record<string, Record<string, unknown>>
      const signed: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rsigs)) {
        const cur = FORMS[k as FormKey]?.version ?? null
        signed[k] = { at: S(v.at, 40), typed_name: S(v.typed_name, 120), version: Number(v.version), current_version: cur, version_mismatch: cur != null && Number(v.version) !== cur,
          ip: S(v.ip, 64) || null, agent: S(v.agent, 200) || null, fingerprint: S(v.fingerprint, 64) || null, pdf: !!(fr?.pdfs || {})[k] }
      }
      await db.from('document_access_log').insert({ offer_id: oid, doc: 'step1:review', path: '(the Step 1 screens, read only)', by_person: staff.person_id, by_email: staff.email, by_name: staff.name, ip: ipOf(req), reason: 'opened Step 1 as the applicant saw it' })
      return json({ ok: true, review: true, who: rwho, forms: await formsPayload({}, rctx), order: formsInPlay(rctx), screens: step1Screens(rctx), hepb_status: hepbStatus, answers: fr?.answers || {}, signatures: publicSignatures(rsigs), signed,
        identity: { ...identState(idr), license_state: idr?.license_state ?? null, license_expires: idr?.license_expires ?? null },
        prefill: prefillFrom(app, app?.post_interview || null), hints: { availability: S(app?.availability, 300) || null, travel: S(app?.post_interview?.travel_areas, 200) || null },
        current_screen: fr?.current_screen || '1', started_at: fr?.started_at || null, completed_at: fr?.completed_at || null, esign_consent_at: fr?.esign_consent_at || null, esign_consent_detail: fr?.esign_consent_detail || null,
        countersignatures: Object.fromEntries(Object.entries((fr?.countersignatures || {}) as Record<string, Record<string, unknown>>).map(([k, v]) => [k, { at: v.at, typed_name: v.typed_name, by_name: v.by_name }])),
        countersign_forms: FORM_ORDER.filter((k) => FORMS[k].countersign), may_countersign: mayApprove(normalizePerms((await db.from('app_data').select('data').eq('key', PERM_KEY).maybeSingle()).data?.data), 'work', { person_id: staff.person_id, roles: staff.roles, email: staff.email }),
        practice: !!fr?.practice, sent_at: o.step1_sent_at || null, test_mode: false, references_required: REFERENCES_REQUIRED, skill_groups: SKILL_GROUPS, skills: SKILLS, signed_count: Object.keys(rsigs).length, form_count: formCount((fr?.answers || {}) as Record<string, unknown>, rctx), deciding: DECIDING })
    }
    /* ───── PREVIEW (Samantha 2026-10-11: "I want to be able to click through the screens as though I were the caregiver,
       using practice data, before approving them for real hires"). Public and read-only: no link, no offer, no database read
       or write, nothing sent. The same versioned words, the same required-answer check and the same PDF layout as a real
       Step 1, for the made-up Pat Preview; the page keeps the answers in its own memory and never sends identity numbers. ───── */
    if (action === 'preview') return json(await preview(b))
    const id = S(b.o, 64)
    if (!(await checkLink(secret, 'step1', id, b.e, b.t))) return json(NOPE, 401)
    const T = trn()
    const o = await T.get(id); if (!o) return json(NOPE, 404)
    const gone = dead(o); if (gone) return json(gone.body, gone.status)
    const who = { first: S(o.first_name, 60), last: S(o.last_name, 60), phone: S(o.phone, 30), email: S(o.email, 160), position: S(o.position, 80) || 'Caregiver' }
    let { data: row } = await db.from('step1_forms').select('*').eq('offer_id', id).maybeSingle()
    const { data: ident } = await db.from('step1_identity').select('ssn_last4,dob_sealed,license_last4,license_state,license_expires,ssn_sealed').eq('offer_id', id).maybeSingle()
    const IS = identState(ident)
    const sigs = (row?.signatures || {}) as Record<string, Record<string, unknown>>
    const now = () => new Date().toISOString()
    let ctx = step1Ctx(row)

    if (action === 'view') {
      if (!row) {
        /* 2026-10-13: whether the Hepatitis B form is in this Step 1 is decided now, once, and kept (step1Ctx) */
        const { data: made, error } = await db.from('step1_forms').insert({ offer_id: id, started_at: now(), current_screen: '1', practice: practiceOffer(o), hepb_form: hepbFormAtStart(practiceOffer(o)) }).select('*').maybeSingle()
        if (error) { const again = await db.from('step1_forms').select('*').eq('offer_id', id).maybeSingle(); row = again.data } else row = made
        ctx = step1Ctx(row)
        if (row) await T.event({ offer_id: id, kind: 'step1_started', by_who: 'caregiver', channel: 'page', detail: { ip: ipOf(req), agent: agentOf(req) } })
      }
      /* 2026-10-11: the practice mark kept true to the offer (the reference page asks task questions only for practice hires) */
      if (row && !!row.practice !== practiceOffer(o)) { await db.from('step1_forms').update({ practice: practiceOffer(o) }).eq('offer_id', id); row.practice = practiceOffer(o) }
      // never ask twice: the application (by email, then by phone) and its interview answers
      const app = await applicationOf(db, who)
      const forms = await formsPayload({}, ctx)
      /* 2026-10-13: after the Hepatitis B form, someone who said they completed the series or are immune may add the proof on
         their private hepatitis B page (the link only; never the answer itself) */
      let hepbProof: string | null = null
      if (ctx.hepb && sigs.hepb_vaccination && !practiceOffer(o)) { try { const { data: hr } = await db.from('hepb_record').select('id, status, verified_at').eq('offer_id', id).maybeSingle()
        if (hr && ['prior_series', 'immune'].includes(hr.status) && !hr.verified_at) hepbProof = await makeHepbLink(secret, String(hr.id)) } catch { hepbProof = null } }
      return json({ ok: true, who, forms, order: formsInPlay(ctx), screens: step1Screens(ctx), answers: row?.answers || {}, signatures: publicSignatures(sigs), identity: { ...IS, license_state: ident?.license_state ?? null, license_expires: ident?.license_expires ?? null },
        prefill: prefillFrom(app, app?.post_interview || null), hints: { availability: S(app?.availability, 300) || null, travel: S(app?.post_interview?.travel_areas, 200) || null },
        current_screen: row?.current_screen || '1', started_at: row?.started_at || null, completed_at: row?.completed_at || null, esign_consent_at: row?.esign_consent_at || null,
        hepb_proof_link: hepbProof, test_mode: practiceOffer(o) || !allApprovedForReal(ctx), references_required: REFERENCES_REQUIRED, skill_groups: SKILL_GROUPS, skills: SKILLS, signed_count: Object.keys(sigs).length, form_count: formCount((row?.answers || {}) as Record<string, unknown>, ctx), deciding: DECIDING })
    }
    if (!row) return json({ ok: false, error: 'Please open your Step 1 link first.' }, 409)
    /* 2026-10-13 (Samantha's driver rules): a photo or file of the license front/back or the insurance proof goes straight to
       the private driver-docs store by a one-use signed link; 'uploaded' then records it on their answers (checked against
       this offer and item). Only for a photo item on a form that applies to them and is not signed yet. */
    if (action === 'upload_url' || action === 'uploaded') {
      const item = S(b.item, 40), fk = formOf(item), it = fk ? itemsOf(FORMS[fk]).find((x) => x.id === item) : null
      if (!fk || !it || it.kind !== 'photo') return json({ ok: false, error: 'Which picture?' }, 400)
      if (!formApplies(fk, (row.answers || {}) as Record<string, unknown>, ctx)) return json({ ok: false, error: 'Please answer the question at the top of this screen first.' }, 409)
      if (sigs[fk]) return json({ ok: false, error: `${FORMS[fk].title} is already signed, so its pictures cannot change here. Call the office: (417) 234-8494.` }, 409)
      const prefix = `offer/${id}/${item}-`
      if (action === 'upload_url') {
        const ext = S(b.ext, 5).toLowerCase(); if (!PHOTO_TYPES[ext]) return json({ ok: false, error: 'Please use a photo (JPG, PNG, HEIC) or a PDF.' }, 400)
        const path = prefix + Date.now() + '.' + ext
        const { data, error } = await db.storage.from(DRIVER_BUCKET).createSignedUploadUrl(path)
        if (error || !data) return json({ ok: false, error: 'Could not get the upload ready. Please try again.' }, 500)
        return json({ ok: true, path, token: data.token, signed_url: data.signedUrl, content_type: PHOTO_TYPES[ext] })
      }
      const path = S(b.path, 200)
      if (!path.startsWith(prefix) || !/^[\w./-]+$/.test(path)) return json({ ok: false, error: 'That picture is not yours.' }, 400)
      const dir = path.slice(0, path.lastIndexOf('/')), name = path.slice(path.lastIndexOf('/') + 1)
      const { data: found } = await db.storage.from(DRIVER_BUCKET).list(dir, { search: name, limit: 5 })
      if (!(found ?? []).some((x: { name: string }) => x.name === name)) return json({ ok: false, error: 'The picture did not arrive. Please try again.' }, 409)
      const ext = name.split('.').pop() || '', answers = { ...(row.answers || {}) } as Record<string, unknown>
      answers[item] = { path, content_type: PHOTO_TYPES[ext] || 'application/octet-stream', at: now() }
      const { error } = await db.from('step1_forms').update({ answers }).eq('offer_id', id)
      if (error) return json({ ok: false, error: 'Could not save: ' + error.message }, 500)
      return json({ ok: true, item, uploaded: true })
    }
    /* 2026-10-13: a copy of one form to open or save while reading it (unsigned; their answers so far; identity never printed) */
    if (action === 'document') {
      const form = S(b.form, 40) as FormKey
      if (!formsInPlay(ctx).includes(form)) return json({ ok: false, error: 'Which form?' }, 400)
      const bytes = step1FormPdf(FORMS[form], (row.answers || {}) as Record<string, unknown>, who, IS, null, formsInPlay(ctx).indexOf(form) + 1, formsInPlay(ctx).length)
      let bin = ''; for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000))
      return json({ ok: true, form, version: FORMS[form].version, pdf_base64: btoa(bin) })
    }
    if (action === 'begin') {
      if (b.esign_consent !== true) return json({ ok: false, error: 'Please tick "I agree to complete and sign my Step 1 paperwork electronically" first.' }, 400)
      if (!row.esign_consent_at) {
        /* 2026-10-13: the words they agreed to are kept with the consent (RSMo 432.220: agreement to do business electronically), and the trail records it */
        const { data: did } = await db.from('step1_forms').update({ esign_consent_at: now(), esign_consent_detail: { ip: ipOf(req), agent: agentOf(req), words: ESIGN_WORDS }, current_screen: '2' }).eq('offer_id', id).is('esign_consent_at', null).select('offer_id')
        if (did?.length) await T.event({ offer_id: id, kind: 'step1_started', by_who: 'caregiver', channel: 'page', result: 'esign_consent', detail: { note: 'agreed to sign electronically', ip: ipOf(req), agent: agentOf(req), words: ESIGN_WORDS } })   /* an existing kind: offer_events allows a fixed list */
      }
      return json({ ok: true })
    }
    if (action === 'save') {
      const screen = S(b.screen, 4); if (screen && !step1Screens(ctx).includes(screen)) return json({ ok: false, error: 'Which screen?' }, 400)
      const incoming = (b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers)) ? b.answers as Record<string, unknown> : {}
      const merged = { ...(row.answers || {}) } as Record<string, unknown>; const rejected: string[] = []
      for (const [k, v] of Object.entries(incoming)) {
        if (IDENTITY_IDS.includes(k)) return json({ ok: false, error: 'The Social Security number, date of birth and license number go through the locked door, never here.' }, 400)
        if (k === 'initials') { const c = clean({ id: 'initials', label: '', kind: 'initials' }, v); if (c === undefined) rejected.push(k); else merged.initials = c; continue }
        /* 2026-10-13: a deciding answer (transport_willing) is locked once either form it chooses is signed */
        if (DECIDING[k]) {
          const decided = FORM_ORDER.filter((f) => FORMS[f].when?.id === k && sigs[f])
          if (decided.length) return json({ ok: false, error: `${FORMS[decided[0]].title} is already signed, so this answer cannot change here. To change it, call the office: (417) 234-8494.` }, 409)
          if (v == null || v === '') { delete merged[k]; continue }
          if (!DECIDING[k].options.some(([x]) => x === v)) { rejected.push(k); continue }
          merged[k] = v; continue
        }
        const fk = formOf(k); if (!fk) { rejected.push(k); continue }
        if (FORMS[fk].when && !formApplies(fk, merged)) { rejected.push(k); continue }
        if (itemsOf(FORMS[fk]).find((i) => i.id === k)?.kind === 'photo') { rejected.push(k); continue }   /* photos arrive only through 'uploaded' */
        if (sigs[fk]) return json({ ok: false, error: `${FORMS[fk].title} is already signed, so its answers cannot change. If something is wrong, call the office: (417) 234-8494.` }, 409)
        const item = itemsOf(FORMS[fk]).find((i) => i.id === k)!
        if (v == null || v === '') { delete merged[k]; continue }
        const c = clean(item, v); if (c === undefined) { rejected.push(k); continue }
        merged[k] = c
      }
      const upd: Record<string, unknown> = { answers: merged }; if (screen) upd.current_screen = screen
      const { error } = await db.from('step1_forms').update(upd).eq('offer_id', id)
      if (error) return json({ ok: false, error: 'Could not save: ' + error.message }, 500)
      return json({ ok: true, saved: Object.keys(incoming).length - rejected.length, rejected })
    }
    if (action === 'identity') {
      if (kek.length < 40) return json({ ok: false, error: 'The lock is not set up on the server. Nothing was saved.' }, 500)
      const upd: Record<string, unknown> = { updated_at: now() }; const did: string[] = []
      if (b.ssn != null) {
        if (sigs.edl_fcsr_consent) return json({ ok: false, error: 'The consent form is already signed, so the Social Security number and date of birth cannot change here. Call the office: (417) 234-8494.' }, 409)
        const ssn = digits(b.ssn), ssn2 = digits(b.ssn2)
        if (ssn !== ssn2) return json({ ok: false, error: 'The two Social Security numbers do not match. Please type it twice, digits only.' }, 400)
        if (!ssnAllowed(ssn, practiceOffer(o))) return json({ ok: false, error: 'That does not look like a Social Security number. Please check it.' + (practiceOffer(o) ? ' For a practice or training hire, use 987-65-4321 (a number never issued to anyone).' : '') }, 400)
        upd.ssn_sealed = await seal(kek, id, ssn); upd.ssn_last4 = last4(ssn); did.push('ssn')
      }
      if (b.dob != null) {
        if (sigs.edl_fcsr_consent) return json({ ok: false, error: 'The consent form is already signed. Call the office: (417) 234-8494.' }, 409)
        const dob = S(b.dob, 10); const t = Date.parse(dob)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(t) || t > Date.now() - 16 * 365.25 * 86400000 || t < Date.parse('1900-01-01')) return json({ ok: false, error: 'Please enter your date of birth as a full date (you must be at least 16).' }, 400)
        upd.dob_sealed = await seal(kek, id, dob); did.push('dob')
      }
      if (b.license_number != null) {
        if (sigs.vehicle) return json({ ok: false, error: 'The vehicle form is already signed. Call the office: (417) 234-8494.' }, 409)
        const ln = S(b.license_number, 30).replace(/\s+/g, '').toUpperCase()
        if (!/^[A-Z0-9-]{4,20}$/.test(ln)) return json({ ok: false, error: 'Please enter the license number as it appears on the card (letters and numbers).' }, 400)
        upd.license_sealed = await seal(kek, id, ln); upd.license_last4 = last4(ln); did.push('license')
        if (b.license_state != null) upd.license_state = S(b.license_state, 2).toUpperCase() || null
        if (b.license_expires != null) upd.license_expires = /^\d{4}-\d{2}-\d{2}$/.test(S(b.license_expires, 10)) ? S(b.license_expires, 10) : null
      }
      if (!did.length) return json({ ok: false, error: 'Nothing to save.' }, 400)
      const { error } = await db.from('step1_identity').upsert({ offer_id: id, ...upd }, { onConflict: 'offer_id' })
      if (error) return json({ ok: false, error: 'Could not save: ' + error.message }, 500)
      const after = await db.from('step1_identity').select('ssn_last4,dob_sealed,license_last4,license_state,license_expires').eq('offer_id', id).maybeSingle()
      return json({ ok: true, saved: did, identity: { ...identState(after.data), license_state: after.data?.license_state ?? null, license_expires: after.data?.license_expires ?? null } })
    }
    if (action === 'copies') {
      const out: Record<string, string> = {}
      for (const [k, p] of Object.entries((row.pdfs || {}) as Record<string, string>)) { const { data } = await db.storage.from(BUCKET).createSignedUrl(p, 600); if (data?.signedUrl) out[k] = data.signedUrl }
      /* 2026-10-13: their own signed Hepatitis B form, from the private medical-record store (only to them, on their own link) */
      if (ctx.hepb && sigs.hepb_vaccination && !practiceOffer(o)) {
        try { const { data: hr } = await db.from('hepb_record').select('step1_pdf, declination_pdf').eq('offer_id', id).maybeSingle()
          if (hr?.step1_pdf) { const { data } = await db.storage.from(HEPB_BUCKET).createSignedUrl(hr.step1_pdf, 600); if (data?.signedUrl) out.hepb_vaccination = data.signedUrl } } catch { /* the copy comes later */ }
      }
      return json({ ok: true, copies: out, expires_in: 600 })
    }
    if (action === 'sign') {
      const form = S(b.form, 40) as FormKey
      if (!formsInPlay(ctx).includes(form)) return json({ ok: false, error: 'Which form?' }, 400)
      if (!formApplies(form, (row.answers || {}) as Record<string, unknown>, ctx)) return json({ ok: false, error: FORMS[form].when ? 'Please answer the question at the top of this screen first: ' + (DECIDING[FORMS[form].when!.id]?.label || 'the question') : 'Which form?' }, 409)
      if (!row.esign_consent_at) return json({ ok: false, error: 'Please agree to sign electronically on the first screen before signing a form.' }, 409)
      if (b.consent !== true) return json({ ok: false, error: 'Please tick "I agree to sign this form electronically" first.' }, 400)
      const name = S(b.typed_name, 80)
      if (!/^\S+(\s+\S+)+$/.test(name) || name.length < 4) return json({ ok: false, error: 'Please type your full name, first and last, exactly as you want it on the form.' }, 400)
      /* 2026-10-13: a real applicant signs only wording Samantha approved for real (practice and training hires are not held) */
      if (!practiceOffer(o) && !approvedForReal(form)) return json({ ok: false, error: 'This form is waiting for its final approval, so it cannot be signed yet. Your answers are saved. The office will let you know when it is ready: (417) 234-8494.', not_approved: true }, 409)
      if (sigs[form]) return json({ ok: false, error: 'This form is already signed. A signed form is never changed; if something is wrong, call the office: (417) 234-8494.', already: true }, 409)
      const before = FORM_ORDER.slice(0, FORM_ORDER.indexOf(form)).filter((k) => !sigs[k] && formApplies(k, (row.answers || {}) as Record<string, unknown>, ctx))
      if (before.length) return json({ ok: false, error: `Please sign ${FORMS[before[0]].title} first; the forms go in order.` }, 409)
      const answers = { ...(row.answers || {}) } as Record<string, unknown>
      if (FORMS[form].signature === 'typed+initials') { const ini = clean({ id: 'initials', label: '', kind: 'initials' }, b.initials ?? answers.initials); if (ini === undefined) return json({ ok: false, error: 'Please add your initials beside the AxisCare scheduling line.' }, 400); answers.initials = ini }
      const miss = [...missing(form, answers, IS), ...choiceMissing(form, b.choice, b.decline_consent)]
      if (miss.length) return json({ ok: false, error: 'Please answer these first: ' + miss.join('; ') + '.', missing: miss }, 400)
      const at = now(), ip = ipOf(req), agent = agentOf(req), version = FORMS[form].version, fp = await formFingerprint(form)
      const sig = { at, typed_name: name, ip, agent, version, fingerprint: fp, consent: true }
      /* ───── 2026-10-13 HEPATITIS B IN STEP 1: the choice goes to the confidential hepatitis B record FIRST (never into the
         Step 1 answers or this signature), so a failure after this point never loses it and a retry finds the same record.
         Practice and training hires: nothing medical is recorded and nobody is told (their signature alone is kept). ───── */
      const confidential = !!FORMS[form].confidential
      const choice = confidential ? S(b.choice, 20) : ''
      const practice = practiceOffer(o) || practicePerson(who.phone, who.email)
      let hepb: Record<string, unknown> | null = null
      if (confidential && !practice) {
        const { data: stRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
        hepb = await stepOneRecord(db, (stRow?.data && typeof stRow.data === 'object') ? stRow.data : {}, { offerId: id, name: `${who.first} ${who.last}`.trim(), position: who.position, choice, at, typedName: name, ip, agent, formVersion: version, formFingerprint: fp })
        if (!hepb.ok) return json({ ok: false, error: 'We could not save your answer, so this form is not signed yet. Your choice is kept on this page. Please tap the button again, or call the office: (417) 234-8494.' }, 500)
      }
      // 1. the signature, only while still unsigned (a race cannot sign twice; the trigger refuses a change anyway)
      const { data: wrote, error: wErr } = await db.from('step1_forms').update({ signatures: { ...sigs, [form]: sig }, answers }).eq('offer_id', id).filter('signatures->' + form, 'is', null).select('offer_id')
      if (wErr || !wrote?.length) return json({ ok: false, error: 'This form was just signed. A signed form is never changed.', already: true }, 409)
      await T.event({ offer_id: id, kind: 'step1_signed', by_who: 'caregiver', channel: 'page', doc_version: version, fingerprint: fp, detail: { form, typed_name: name, ip, agent, consent: true, signed_at: at } })
      // 2. the PDF: the same words as the screen with the answers, written once, never overwritten
      const order = formsInPlay(ctx)
      const bytes = step1FormPdf(FORMS[form], confidential ? { ...answers, __choice: choice } : answers, who, IS, { typedName: name, signedAtCentral: longDateTime(at), signedAtUtc: at, ip, agent, version, fingerprint: fp, offerId: id, docName: FORMS[form].title }, order.indexOf(form) + 1, order.length)
      let path = `step1/${id}/${form}-v${version}-${at.replace(/[:.]/g, '-')}.pdf`
      let pdfOk = true, hepbOut: Record<string, unknown> | null = null
      /* the Hepatitis B form: its PDF (and a declination's Appendix A PDF) go only to the private hepb-docs store, on the
         confidential record; nothing goes to the onboarding store or to step1_forms.pdfs (the office's profile lists those) */
      const up = confidential ? { error: null } : await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
      if (confidential) {
        if (practice) { pdfOk = false; hepbOut = { practice: true } }
        else { hepbOut = await hepbAfterSign(db, req, hepb!.row as Record<string, unknown>, { who, choice, name, at, ip, agent, bytes, offerId: id }); pdfOk = hepbOut.pdf === true; path = String(hepbOut.path || '') }
      } else if (up.error) { pdfOk = false; await T.event({ offer_id: id, kind: 'step1_signed', by_who: 'system', channel: 'page', doc_version: version, fingerprint: fp, result: 'pdf_failed', detail: { form, error: String(up.error.message || up.error).slice(0, 200) } })
        await problemCard(db, 's1pdf_' + id + '_' + form, { kind: 'step1_pdf_failed', who: `${who.first} ${who.last}`.trim(), offer_id: id, title: 'A signed Step 1 form has no PDF yet: ' + `${who.first} ${who.last}`.trim(),
          detail: 'The signature on ' + FORMS[form].title + ' is recorded (time, device, wording version), but its PDF could not be saved (' + S(up.error.message || up.error, 120) + '). Tell Claude so the PDF is made again from the signed record.' }) }
      else if (!confidential) await db.from('step1_forms').update({ pdfs: { ...(row.pdfs || {}), [form]: path } }).eq('offer_id', id).filter('pdfs->' + form, 'is', null)
      // 3. the last signature completes Step 1: the record, the trail, and the offer record the office reads
      /* 2026-10-13: never complete while a deciding question is unanswered (its form is still to come) */
      const allSigned = Object.keys(DECIDING).every((k) => answers[k]) && applicableForms(answers, ctx).every((k) => k === form || sigs[k])
      let done = false
      if (allSigned) {
        const { data: fin } = await db.from('step1_forms').update({ completed_at: at, current_screen: '9', receipt: { completed_at: at, forms: applicableForms(answers, ctx).length } }).eq('offer_id', id).is('completed_at', null).select('offer_id')
        done = !!fin?.length
        if (done) { await T.event({ offer_id: id, kind: 'step1_done', by_who: 'caregiver', channel: 'page', detail: { forms: applicableForms(answers, ctx).length, ip, agent } }); await T.patch(id, { step1_done_at: at }, '&step1_done_at=is.null')
          await db.from('step1_forms').update({ receipt: { completed_at: at, forms: applicableForms(answers, ctx).length, ghl_note: await ghlStep1Note(db, o, who, id, at) } }).eq('offer_id', id)
          /* 2026-10-13: their driver record from Step 1 (Non-Driver, or Driver Pending Verification with the pictures); never silent */
          const dr = await driverFromStep1(db, id, who, answers, { ...sigs, [form]: sig }, { ...(row.pdfs || {}), ...(pdfOk && !confidential ? { [form]: path } : {}) }, at).catch((e: Error) => ({ ok: false, error: String(e?.message || e) }))
          if ((dr as Record<string, unknown>)?.ok === false) await problemCard(db, 's1drv_' + id, { kind: 'step1_driver_failed', who: `${who.first} ${who.last}`.trim(), offer_id: id, title: 'Driver Compliance record not made from Step 1: ' + `${who.first} ${who.last}`.trim(), detail: 'Step 1 is complete, but their Driver Compliance record could not be made (' + S((dr as Record<string, unknown>).error, 120) + '). Set it up from their Driver Compliance card, or tell Claude.' })
          const cs = needsCountersign({ ...sigs, [form]: true }, {})
          if (cs.length) await problemCard(db, 's1cs_' + id, { kind: 'step1_countersign', who: `${who.first} ${who.last}`.trim(), offer_id: id, title: 'Sign for Caring Companions: ' + cs.map((k) => FORMS[k].title).join(', ') + ' for ' + `${who.first} ${who.last}`.trim(),
            detail: `${who.first} signed ${cs.map((k) => FORMS[k].title).join(', ')}. A person on the Approve to Work list signs for the company from their page (See their Step 1 screens). Approve to Work waits for it.` }, 'today') }
      }
      /* SLICE 2d: land what this form holds for the office, then the done stamp with the last one.
         STEP 1 BEFORE CHECKS (Samantha 2026-10-11): on the new path nobody is in Background & References before Step 1 is
         complete, so a form signed before then usually has no record to land on yet: that is expected, not a failure. The
         last signature puts them in (the server, never the office), lands every form, and tells Recruiting to start. */
      let landed = await land(db, id, landingPatch(form, answers, at), 'step1 ' + form)
      if (!done && landed.ok === false && landed.reason === 'no_candidate') landed = { skipped: true, why: 'not in Background & References until Step 1 is complete' }
      let entered: Record<string, unknown> = { skipped: true }
      if (done) {
        entered = await enterChecks(db, id, who, o, at)
        /* a record made or linked just now never saw the earlier forms: land them all now (an existing one already has them) */
        if (entered.ok === true && entered.how !== 'already') {
          for (const f of FORM_ORDER) { const p = landingPatch(f, answers, String(sigs[f]?.at || at)); if (p && f !== form) await land(db, id, p, 'step1 ' + f + ' (at completion)') }
          if (landed.ok !== true) landed = await land(db, id, landingPatch(form, answers, at), 'step1 ' + form + ' (at completion)')
        }
      }
      const landedDone = done ? await land(db, id, { step1_done_at: at, step1_landed: { done: at } }, 'step1 done') : { skipped: true }
      if (landed.ok === false || landedDone.ok === false || entered.ok === false) {
        await T.event({ offer_id: id, kind: 'step1_signed', by_who: 'system', channel: 'page', result: 'landing_failed', detail: { form, landed, landedDone, entered } })
        /* entering failed has its own card (enterChecks); a form that did not land on their record gets one too */
        if (entered.ok !== false) await problemCard(db, 's1landform_' + id, { kind: 'step1_landing_failed', who: `${who.first} ${who.last}`.trim(), offer_id: id, title: 'Step 1 answers did not reach their Background & References record: ' + `${who.first} ${who.last}`.trim(),
          detail: 'The answers on ' + FORMS[form].title + ' could not be copied onto their Background & References record (' + S((landed as Record<string, unknown>).error || (landedDone as Record<string, unknown>).error || 'no reason given', 120) + '). Their signed forms are safe on their profile. Check their references and details there, or tell Claude.' })
      }
      const cp = pdfOk ? await db.storage.from(confidential ? HEPB_BUCKET : BUCKET).createSignedUrl(path, 600) : { data: null }
      return json({ ok: true, form, signed_at: at, version, fingerprint: fp, pdf: pdfOk, copy_url: cp.data?.signedUrl ?? null, done, signed_count: Object.keys(sigs).length + 1, form_count: formCount(answers, ctx), landed, landed_done: landedDone,
        ...(confidential ? { practice, proof_link: (hepbOut?.proof_link as string) || null } : {}) })
    }
    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ ok: false, error: 'Something went wrong: ' + ((e as Error).message || 'error') + '. Nothing was changed.' }, 500)
  }
})
