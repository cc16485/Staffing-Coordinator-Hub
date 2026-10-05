// =============================================================================
// caregiver-profile — one caregiver profile, built during onboarding (Desktop 409, 2026-10-01). Part 2, slice 2a.
// =============================================================================
// Samantha: ONE profile for both "introduce your caregiver" and "caregiver change" (those messages are 2b). The card
// shows a photo, first name + last initial, about me, experience caring for others and why they enjoy caregiving, so a
// senior feels comfortable and remembers who is coming. The office drafts it ahead of the welcome call (AI, from their
// application and in-person interview), reads it to them on the call, types what they add or change, then sends their
// personal link: a photo is REQUIRED, a short video is encouraged. New hires need a published profile before working
// (that gate is 2c; it checks caregiver_profiles.published / caregiver_profile_published()).
//
// Deployed with verify_jwt FALSE because the new hire's page calls it without signing in. So:
//   OFFICE actions call requireStaff() themselves (signed-in Caring Companions office staff only):
//     'draft'     {candidate_id | axiscare_id, first, last, phone, email, intake_id?, redo?} -> creates or reuses their
//                 profile row (a new hire by Hub candidate id; a current employee by AxisCare caregiver id)
//                 and fills about / experience / why from their application + interview (Claude). Missing facts become
//                 [ask: ...] prompts for the office to ask on the call. Returns the row.
//     'send_link' {profile_id, phone?, email?, dry?} -> dry: the exact text + email (nothing sent). Otherwise texts +
//                 emails their personal link (same rules as welcome-call: texts 8am-6pm Central, never to someone whose
//                 application said no to texts, STOP line; email always; every refusal raises a card), stamps
//                 link_sent_at/by and ticks "Photo link sent" on their open welcome call.
//     'publish' / 'unpublish' {profile_id} -> publish refuses (with reasons) unless there is a photo, their permission,
//                 and all three sections are filled with no [ask: ...] prompts left.
//                 Publishing clears needs_review (2b: an older intro moved over, still to be checked). An older
//                 profile that is published but needs_review keeps its personal link open, so they can add a proper
//                 photo and give their OK while families can still see it.
//     'catchup'   {axiscare_id, first, last, legacy_candidate_id?} -> 452: a CURRENT caregiver (already working with us)
//                 fills in their whole profile themselves. Finds or starts their row (AxisCare id, then their older Hub
//                 candidate id), marks it self_complete, and empties any [ask: ...] prompt so their boxes start blank.
//                 A published profile is left alone. No AI.
//   PUBLIC actions need only the personal token (caregiver_profiles.upload_token, never the public card id):
//     'mine'       {t}                -> what their page shows
//     'upload_url' {t, kind, ext}     -> a one-time signed upload link for <id>/<kind>-<time>.<ext>
//     'submit'     {t, preferred_name, about, experience, why_this_work, photo_path, video_path, consent}
// 452 (Samantha, 2026-10-05: "i need the current active caregivers to fully complete their own caregiver profile and
// submit the photo and video as well"): a self_complete profile gets its own text and email, its page asks three
// questions with empty boxes, and it can only be sent (and published) with all three answers, a photo AND a video,
// and their permission. New hires are unchanged.
// The WORDING of every message is fixed here; the caller never supplies message text. No em dashes anywhere.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ghlContactIfAllowed } from '../_shared/optout.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent, inTextHours, withStop } from '../_shared/text-consent.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clean = (v: unknown, n = 80) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const OFFICE = '(417) 234-8494'
const BUCKET = 'caregiver-profiles'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AI_MODEL = 'claude-sonnet-5-5'
export const MAX_TEXT = 900               // per section; the card is meant to be read in a minute
export const MAX_SUBMITS_PER_DAY = 20
export const PUBLISHED_NOTE = 'Your profile is published. Call the office at 417-234-8494 to change it.'
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'heic', 'webp']
export const VIDEO_EXT = ['mp4', 'mov', 'webm']
export const PROMPTS = {
  about: '[ask: two or three things a family should know about them]',
  experience: '[ask: who they have cared for, and for how long]',
  why: '[ask: what they enjoy most about caregiving]',
}

export const profileLink = (token: string) => 'https://cc.mo-care.com/caregiver-profile.html?t=' + encodeURIComponent(token)

/* Samantha: never an em dash in anything a person reads. The AI is told too; this is the belt to its braces. */
export function noDash(s: unknown): string {
  return String(s ?? '').replace(/\s*[\u2014\u2015]\s*/g, ', ').replace(/ ,/g, ',').replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?])/g, '$1').replace(/^\s*,\s*/, '').replace(/[ \t]{2,}/g, ' ')
}
/* Free text from a person: control characters out (new lines kept), no em dashes, trimmed, length-capped. */
export function cleanLong(v: unknown, n = MAX_TEXT): string {
  return noDash(String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, ' '))
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, n).trim()
}
export const hasPrompt = (s: unknown) => /\[/.test(String(s ?? ''))
/* A published profile locks their personal link, EXCEPT an older profile moved over from the intro list (2b,
   needs_review): it stays live (families were already shown it) while they add a proper photo and give their OK. */
// deno-lint-ignore no-explicit-any
export const locked = (p: any) => !!p?.published && p?.needs_review !== true

/* Her words, kept in one place so the Hub preview and the send can never differ. */
const shell = (body: string) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">${body}` +
  `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>${OFFICE}</p></div>`
const btn = (href: string, label: string) => `<p><a href="${href}" style="background:#F0A63A;color:#122F52;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;display:inline-block">${label}</a></p>`
export function linkMessages(first: string, link: string) {
  return {
    text: withStop(`Hi ${first}, it's Caring Companions! Please finish your caregiver profile here: ${link} ` +
      `Add a friendly photo of yourself (we need this one) and, if you like, a short hello video. ` +
      `Then check the words we wrote about you. Families see your profile before you visit, so they know who is coming.`),
    subject: 'Add your photo to your Caring Companions profile',
    html: shell(`<p>Hi ${esc(first)},</p>` +
      `<p>Before your first visit, the family sees a short profile of you, so they know a friendly face is coming. Please take a few minutes to finish yours:</p>` +
      `<ol><li><b>Add a friendly photo of yourself.</b> We need this one. A phone selfie in good light, from the shoulders up, is perfect.</li>` +
      `<li><b>If you like, add a short hello video</b> of about 30 seconds. Say hi and one thing you love about caregiving.</li>` +
      `<li><b>Read the words we wrote about you</b> and change anything that does not sound like you.</li></ol>` +
      btn(link, 'Finish my profile') +
      `<p>This link is just for you, so please do not share it. Questions? Call us at ${OFFICE}.</p>`),
  }
}

/* 452: current caregivers write it themselves. Her words, one place, so the Hub preview and the send never differ. */
export function catchupMessages(first: string, link: string) {
  return {
    text: withStop(`Hi ${first}, it's Caring Companions! We're adding a short profile that our families see before you visit, so they know who's coming. ` +
      `Please fill it in yourself here: ${link} Answer 3 short questions in your own words, and add a friendly photo and a short hello video. It takes about 10 minutes.`),
    subject: 'Your Caring Companions profile: 3 questions, a photo and a short video',
    html: shell(`<p>Hi ${esc(first)},</p>` +
      `<p>We're adding a short profile that our families see before you visit, so they know a friendly face is coming. Please fill yours in yourself. It takes about 10 minutes:</p>` +
      `<ol><li><b>Answer 3 short questions in your own words:</b> what families should know about you, who you have cared for, and what you enjoy most about caregiving.</li>` +
      `<li><b>Add a friendly photo of yourself.</b> A phone selfie in good light, from the shoulders up, is perfect.</li>` +
      `<li><b>Add a short hello video</b> of about 30 seconds. Say hi and one thing you love about caregiving.</li></ol>` +
      btn(link, 'Fill in my profile') +
      `<p>This link is just for you, so please do not share it. Questions? Call us at ${OFFICE}.</p>`),
  }
}
/* 452: what a current caregiver still has to add before their profile can be sent. Their words to read. */
// deno-lint-ignore no-explicit-any
export function selfCompleteMissing(p: any): string[] {
  const out: string[] = []
  const parts: [string, string][] = [['about', 'what families should know about you'], ['experience', 'who you have cared for'], ['why_this_work', 'what you enjoy most about caregiving']]
  for (const [k, label] of parts) {
    const v = String(p?.[k] ?? '').trim()
    if (!v || hasPrompt(v)) out.push(`your answer about ${label}`)
  }
  if (!p?.photo_path) out.push('a photo of yourself')
  if (!p?.video_path) out.push('a short hello video')
  if (p?.consent !== true) out.push('your permission (the box at the bottom)')
  return out
}

/* What stops a profile going in front of a family. Plain reasons the office can act on. */
// deno-lint-ignore no-explicit-any
export function publishProblems(p: any): string[] {
  const out: string[] = []
  if (!p) return ['That profile was not found.']
  if (p.status === 'withdrawn') out.push('This profile was withdrawn. They took their permission back.')
  if (!p.photo_path) out.push('No photo yet. They add it from their photo link (Send photo link).')
  if (p.consent !== true) out.push('They have not given permission yet. They tick the box on their profile page.')
  if (p.self_complete === true && !p.video_path) out.push('No video yet. For a current caregiver the hello video is required; they add it from their profile link.')
  const parts: [string, string][] = [['about', 'About me'], ['experience', 'Experience caring for others'], ['why_this_work', 'Why they enjoy caregiving']]
  for (const [k, label] of parts) {
    const v = String(p[k] ?? '').trim()
    if (!v) out.push(`"${label}" is empty.`)
    else if (hasPrompt(v)) out.push(`"${label}" still has an [ask: ...] prompt. Ask them, type their answer, and take the brackets out.`)
  }
  return out
}

/* ── The AI draft ─────────────────────────────────────────────────────────── */
export const DRAFT_SYSTEM = `You write short caregiver profiles for Caring Companions, an in-home senior care agency in Springfield, Missouri. An older adult and their family read the profile before a new caregiver's first visit. It should help the senior feel comfortable and remind them who is coming.

You get facts from the caregiver's job application and their in-person interview. Write three short sections:
- "about": what they are like as a person and to have around the house
- "experience": their experience caring for others
- "why": why they enjoy caregiving

Rules:
1. Third person, using their first name only. Never a last name.
2. Each section is 2 to 4 short, warm sentences in simple, everyday words. No sales talk and no big claims.
3. Use ONLY facts given in the input. Never invent a job, a number of years, a skill, a story, a hobby or a feeling.
4. Where a section is missing the facts it needs, write a short bracketed prompt for the office to ask on the call, like [ask: what they enjoy most about caregiving]. A section may mix real sentences with a prompt. If there are no facts for a section at all, that section is just one or two prompts.
5. Never mention anything private: age, health or disability (theirs or anyone's), background checks, drug screens, driving record, pay, work papers or immigration, interview scores, smoking or vaping, or the name of any employer, client or family member.
6. Never use an em dash. Use commas or periods instead.
7. Do not mention the application, the interview or this office.

Reply with JSON only, nothing before or after it: {"about": "...", "experience": "...", "why": "..."}`

const SKILL_NAMES: Record<string, string> = { dementia: "Dementia and Alzheimer's care", incontinence: 'Incontinence care', transfers: 'Helping people move and transfer safely', hoyer: 'Hoyer lift', personal_care: 'Personal care' }
const LEVEL: Record<string, string> = { some: 'some experience', lots: 'very experienced' }

/* Only the facts a family-facing profile may draw on. Never: employer or supervisor names, phone numbers, screening
   answers (background, drugs, driving, smoking), pay, office notes or scores. */
// deno-lint-ignore no-explicit-any
export function applicationFacts(first: string, app: any, questions: Record<string, string> = {}) {
  // deno-lint-ignore no-explicit-any
  const f: Record<string, any> = { first_name: first }
  if (!app) return f
  const pos = clean(app.posting_title || app.position, 80); if (pos) f.applied_for = pos
  if (app.experience_years) f.years_of_experience = clean(app.experience_years, 40)
  if (Array.isArray(app.experience_kinds) && app.experience_kinds.length) f.kinds_of_care_experience = app.experience_kinds.map((x: unknown) => clean(x, 80)).filter(Boolean)
  if (app.experience) f.experience_in_their_words = cleanLong(app.experience, 1200)
  const wh = Array.isArray(app.work_history) ? app.work_history : []
  // deno-lint-ignore no-explicit-any
  const jobs = wh.map((w: any) => ({ role: clean(w?.role, 80), from: clean(w?.from, 20), to: w?.current ? 'now' : clean(w?.to, 20), duties: clean(w?.duties, 300) }))
    // deno-lint-ignore no-explicit-any
    .filter((j: any) => j.role || j.duties).map((j: any) => Object.fromEntries(Object.entries(j).filter(([, v]) => v)))
  if (jobs.length) f.past_jobs_no_employer_names = jobs
  const pi = app.post_interview && typeof app.post_interview === 'object' ? app.post_interview : null
  if (pi) {
    const skills = Object.entries(pi.skills || {}).filter(([, v]) => LEVEL[String(v)]).map(([k, v]) => `${SKILL_NAMES[k] || k}: ${LEVEL[String(v)]}`)
    if (skills.length) f.care_skills = skills
    if (pi.custom_skill) f.also_good_at = clean(pi.custom_skill, 200)
    // deno-lint-ignore no-explicit-any
    const said = Object.entries(pi.script || {}).filter(([k, a]: [string, any]) => a && a.note && questions[k])
      // deno-lint-ignore no-explicit-any
      .map(([k, a]: [string, any]) => ({ question: questions[k], what_they_said: cleanLong(a.note, 600) }))
    if (said.length) f.interview_answers = said
  }
  return f
}

/* The model's reply, made safe: three strings, no em dashes, no last name, length-capped, prompts where empty. */
export function sanitiseDraft(raw: unknown, first = '', last = '') {
  // deno-lint-ignore no-explicit-any
  let o: any = raw
  if (typeof raw === 'string') {
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
    try { o = s >= 0 && e > s ? JSON.parse(raw.slice(s, e + 1)) : {} } catch { o = {} }
  }
  o = o && typeof o === 'object' ? o : {}
  const fix = (v: unknown, fallback: string) => {
    let t = cleanLong(String(v ?? '').replace(/\s*\n+\s*/g, ' '), MAX_TEXT).replace(/^["'\s]+|["'\s]+$/g, '')
    const ln = clean(last, 60)
    if (ln.length >= 2) {
      const re = new RegExp('\\b' + ln.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi')
      t = t.replace(new RegExp('\\b' + clean(first, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+' + ln.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), clean(first, 40))
        .replace(re, '').replace(/[ \t]{2,}/g, ' ').trim()
    }
    return t || fallback
  }
  return { about: fix(o.about, PROMPTS.about), experience: fix(o.experience, PROMPTS.experience), why: fix(o.why ?? o.why_this_work, PROMPTS.why) }
}

/* Is the application really this person? A candidate id that happens to collide must not hand over a stranger's story. */
// deno-lint-ignore no-explicit-any
export function samePerson(app: any, who: { first?: string; phone?: string; email?: string }): boolean {
  if (!app) return false
  const d = (s: unknown) => String(s ?? '').replace(/\D/g, '').slice(-10)
  const e = (s: unknown) => String(s ?? '').trim().toLowerCase()
  if (who.email && e(app.email) && e(app.email) === e(who.email)) return true
  if (d(who.phone).length === 10 && d(app.phone) === d(who.phone)) return true
  const f = (s: unknown) => String(s ?? '').trim().toLowerCase().slice(0, 3)
  if (who.first && f(app.first_name) && f(app.first_name) === f(who.first)) return true
  return !who.first && !who.phone && !who.email
}

const APP_COLS = 'id, first_name, last_name, phone, email, position, posting_title, experience, experience_years, experience_kinds, work_history, post_interview, created_at'
const PROFILE_COLS = 'id, candidate_id, axiscare_id, applicant_id, first_name, last_name, preferred_name, about, experience, why_this_work, years_experience, photo_path, video_path, consent, consent_at, published, status, drafted_at, drafted_by, link_sent_at, link_sent_by, submitted_at, published_at, published_by, updated_at, needs_review, self_complete'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const action = String(b.action || '')
  const now = new Date().toISOString()
  const publicUrl = (p: string | null) => p ? Deno.env.get('SUPABASE_URL') + '/storage/v1/object/public/' + BUCKET + '/' + p : null

  /* ── PUBLIC: the new hire's own page, by personal token ── */
  if (['mine', 'upload_url', 'submit'].includes(action)) {
    const t = String(b.t || '')
    const sorry = { error: 'We could not find your profile. Please use the newest link we texted or emailed you, or call ' + OFFICE + '.' }
    if (!UUID.test(t)) return json(sorry, 404)
    const { data: p, error } = await db.from('caregiver_profiles').select(PROFILE_COLS + ', submit_count, submit_day').eq('upload_token', t).maybeSingle()
    if (error) return json({ error: 'Something went wrong on our side. Please try again in a minute.' }, 500)
    if (!p || p.status === 'withdrawn') return json(sorry, 404)

    if (action === 'mine') return json({
      first_name: p.first_name, preferred_name: p.preferred_name, about: p.about, experience: p.experience,
      why_this_work: p.why_this_work, years_experience: p.years_experience, photo_url: publicUrl(p.photo_path),
      video_url: publicUrl(p.video_path), published: locked(p), consent: !!p.consent, self_complete: p.self_complete === true,
    })
    if (locked(p)) return json({ error: PUBLISHED_NOTE, published: true }, 409)
    const today = now.slice(0, 10)
    if (p.submit_day === today && (p.submit_count ?? 0) >= MAX_SUBMITS_PER_DAY)
      return json({ error: 'That is a lot of saves for one day. Please try again tomorrow, or call ' + OFFICE + '.' }, 429)

    if (action === 'upload_url') {
      const kind = String(b.kind || ''), ext = String(b.ext || '').toLowerCase().replace(/^\./, '')
      if (kind !== 'photo' && kind !== 'video') return json({ error: 'Photo or video?' }, 400)
      const okList = kind === 'photo' ? IMAGE_EXT : VIDEO_EXT
      if (!okList.includes(ext)) return json({ error: kind === 'photo' ? 'Please choose a photo (JPG, PNG, HEIC or WEBP).' : 'Please choose a video (MP4, MOV or WEBM).' }, 400)
      const path = `${p.id}/${kind}-${Date.now()}.${ext}`
      const { data, error: e } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
      if (e || !data?.token) return json({ error: 'The upload could not start. Please try again.' }, 500)
      return json({ ok: true, path, token: data.token, signed_url: data.signedUrl })
    }

    // submit
    const own = (v: unknown, kind: 'photo' | 'video') => {
      const s = String(v ?? '')
      const exts = (kind === 'photo' ? IMAGE_EXT : VIDEO_EXT).join('|')
      return new RegExp(`^${p.id}/${kind}-\\d{10,16}\\.(${exts})$`).test(s) ? s : null
    }
    const exists = async (path: string) => {
      const slash = path.indexOf('/')
      const { data } = await db.storage.from(BUCKET).list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 5 })
      // deno-lint-ignore no-explicit-any
      return Array.isArray(data) && data.some((o: any) => o?.name === path.slice(slash + 1))
    }
    // deno-lint-ignore no-explicit-any
    const patch: Record<string, any> = {
      preferred_name: clean(b.preferred_name, 40) || null,
      about: cleanLong(b.about) || null, experience: cleanLong(b.experience) || null, why_this_work: cleanLong(b.why_this_work) || null,
      submitted_at: now, updated_at: now,
      submit_day: today, submit_count: p.submit_day === today ? (p.submit_count ?? 0) + 1 : 1,
    }
    const old: string[] = []
    for (const kind of ['photo', 'video'] as const) {
      const key = kind + '_path', given = b[key]
      if (given == null || given === '') continue
      const path = own(given, kind)
      if (!path) return json({ error: `That ${kind} did not upload properly. Please choose it again.` }, 400)
      if (path !== p[key]) {
        if (!(await exists(path))) return json({ error: `That ${kind} did not finish uploading. Please choose it again.` }, 400)
        patch[key] = path
        if (p[key] && String(p[key]).startsWith(p.id + '/')) old.push(p[key])
      }
    }
    if (b.consent === true) { patch.consent = true; if (!p.consent) patch.consent_at = now }
    else if (b.consent === false) { patch.consent = false; patch.consent_at = null }
    /* 452: a current caregiver's profile is only sent complete (the page checks too; this is the server's word). */
    if (p.self_complete === true) {
      const missing = selfCompleteMissing({ ...p, ...patch })
      if (missing.length) return json({ error: 'Not sent yet. Please add ' + missing.join(', ') + '.' }, 400)
    }
    const { error: ue } = await db.from('caregiver_profiles').update(patch).eq('id', p.id)
    if (ue) return json({ error: 'That did not save. Please try again, or call ' + OFFICE + '.' }, 500)
    if (old.length) { try { await db.storage.from(BUCKET).remove(old) } catch { /* the old file stays; harmless */ } }
    return json({ ok: true, needs_photo: !(patch.photo_path || p.photo_path) })
  }

  /* ── OFFICE: signed-in office staff only ── */
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const staff = who.name || who.email

  if (action === 'draft') {
    /* a new hire is keyed by their Hub candidate id; a current employee by their AxisCare caregiver id */
    const cand = clean(b.candidate_id, 40), axid = clean(b.axiscare_id, 40)
    if (!cand && !axid) return json({ error: 'Which candidate or caregiver?' }, 400)
    const first = clean(b.first, 40), last = clean(b.last, 60)
    if (!first) return json({ error: 'They need a first name on their record first.' }, 400)
    const phone = clean(b.phone, 30), email = clean(b.email, 120).toLowerCase()
    // deno-lint-ignore no-explicit-any
    let p: any = null
    if (cand) p = (await db.from('caregiver_profiles').select(PROFILE_COLS).eq('candidate_id', cand).neq('status', 'withdrawn').limit(1)).data?.[0] ?? null
    if (!p && axid) p = (await db.from('caregiver_profiles').select(PROFILE_COLS).eq('axiscare_id', axid).neq('status', 'withdrawn').limit(1)).data?.[0] ?? null
    if (p?.published) return json({ error: 'Their profile is published. Unpublish it first if you want to redo the draft.' }, 409)
    if (p && p.drafted_at && !b.redo) return json({ ok: true, reused: true, profile: p })

    /* their application: by candidate id, then references / paperwork, then email, then phone (as the Hub does) */
    // deno-lint-ignore no-explicit-any
    let app: any = null
    const whoIs = { first, phone, email }
    // deno-lint-ignore no-explicit-any
    const take = (list: any[] | null | undefined) => { const hit = (list ?? []).find((r) => samePerson(r, whoIs)); if (hit) app = hit }
    // deno-lint-ignore no-explicit-any
    const byIds = async (ids: any[]) => { const u = [...new Set(ids.filter((x) => x && UUID.test(String(x))))]; if (u.length) take((await db.from('job_applicants').select(APP_COLS).in('id', u)).data) }
    try {
      if (p?.applicant_id) await byIds([p.applicant_id])
      if (!app && cand && /^\d{1,12}$/.test(cand)) {
        take((await db.from('job_applicants').select(APP_COLS).eq('candidate_id', Number(cand)).order('created_at', { ascending: false }).limit(5)).data)
        // deno-lint-ignore no-explicit-any
        if (!app) await byIds(((await db.from('reference_requests').select('applicant_id').eq('candidate_id', Number(cand)).limit(8)).data ?? []).map((r: any) => r.applicant_id))
        // deno-lint-ignore no-explicit-any
        if (!app) await byIds(((await db.from('hire_intake').select('applicant_id').eq('candidate_id', Number(cand)).limit(5)).data ?? []).map((r: any) => r.applicant_id))
      }
      if (!app && UUID.test(String(b.intake_id || '')))
        // deno-lint-ignore no-explicit-any
        await byIds(((await db.from('hire_intake').select('applicant_id').eq('id', String(b.intake_id)).limit(1)).data ?? []).map((r: any) => r.applicant_id))
      if (!app && email) take((await db.from('job_applicants').select(APP_COLS).ilike('email', email).order('created_at', { ascending: false }).limit(5)).data)
      const d10 = phone.replace(/\D/g, '').slice(-10)
      if (!app && d10.length === 10) {
        const { data } = await db.from('job_applicants').select(APP_COLS).ilike('phone', '%' + d10.slice(-4)).order('created_at', { ascending: false }).limit(25)
        // deno-lint-ignore no-explicit-any
        take((data ?? []).filter((r: any) => String(r.phone ?? '').replace(/\D/g, '').slice(-10) === d10))
      }
    } catch { /* no application: the draft is all prompts */ }

    /* the interview questions they answered, by id, so the AI sees the question and their answer together */
    const qs: Record<string, string> = {}
    const qids = Object.keys(app?.post_interview?.script || {}).filter((k) => UUID.test(k))
    if (qids.length) {
      try {
        const { data } = await db.from('interview_questions').select('id, question, kind').in('id', qids)
        // deno-lint-ignore no-explicit-any
        for (const q of data ?? []) if ((q as any).kind !== 'yesno') qs[(q as any).id] = clean((q as any).question, 200)
      } catch { /* answers without their questions are left out */ }
    }
    const facts = applicationFacts(first, app, qs)
    let draft = { about: PROMPTS.about, experience: PROMPTS.experience, why: PROMPTS.why }, aiNote = ''
    const key = Deno.env.get('ANTHROPIC_API_KEY')
    if (!app) aiNote = 'No online application was found for them, so the draft is all questions to ask on the call.'
    else if (!key) aiNote = 'The AI is not switched on, so the draft is all questions to ask on the call.'
    else {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: AI_MODEL, max_tokens: 900, temperature: 0.4, system: DRAFT_SYSTEM,
            messages: [{ role: 'user', content: 'Facts about this caregiver:\n' + JSON.stringify(facts, null, 2) }] }),
        })
        if (!r.ok) throw new Error('AI ' + r.status)
        const j = await r.json()
        draft = sanitiseDraft(String(j?.content?.[0]?.text ?? ''), first, last)
      } catch (e) {
        console.error('draft failed', String((e as Error)?.message ?? e))
        aiNote = 'The AI could not write a draft just now, so the draft is all questions to ask on the call. You can try Redo draft later.'
      }
    }
    // deno-lint-ignore no-explicit-any
    const fields: Record<string, any> = {
      candidate_id: cand || p?.candidate_id || null, first_name: first, last_name: last || null, applicant_id: app?.id ?? p?.applicant_id ?? null,
      ...(axid ? { axiscare_id: axid } : {}),
      about: draft.about, experience: draft.experience, why_this_work: draft.why,
      drafted_at: now, drafted_by: staff, updated_at: now,
    }
    if (app?.experience_years && (!p?.years_experience || b.redo)) fields.years_experience = clean(app.experience_years, 40)
    if (p) {
      const { data, error } = await db.from('caregiver_profiles').update(fields).eq('id', p.id).select(PROFILE_COLS).single()
      if (error) return json({ error: error.message }, 500)
      p = data
    } else {
      const { data, error } = await db.from('caregiver_profiles').insert({ ...fields, status: 'new', published: false, consent: false }).select(PROFILE_COLS).single()
      if (error) return json({ error: /duplicate|unique/i.test(error.message) ? 'Someone just started their profile. Refresh and try again.' : error.message }, 500)
      p = data
    }
    return json({ ok: true, profile: p, application_found: !!app, note: aiNote || undefined })
  }

  if (action === 'catchup') {
    const axid = clean(b.axiscare_id, 40), legacy = clean(b.legacy_candidate_id, 40)
    const first = clean(b.first, 40), last = clean(b.last, 60)
    if (!axid) return json({ error: 'Which caregiver? (their AxisCare id)' }, 400)
    if (!first) return json({ error: 'They need a first name on their record first.' }, 400)
    // deno-lint-ignore no-explicit-any
    let p: any = (await db.from('caregiver_profiles').select(PROFILE_COLS).eq('axiscare_id', axid).neq('status', 'withdrawn').limit(1)).data?.[0] ?? null
    if (!p && legacy) p = (await db.from('caregiver_profiles').select(PROFILE_COLS).eq('candidate_id', legacy).neq('status', 'withdrawn').limit(1)).data?.[0] ?? null
    if (p && locked(p)) return json({ ok: true, skipped: 'published', profile: p })
    const blank = (v: unknown) => (hasPrompt(v) ? null : (v ?? null))
    if (p) {
      const { data, error } = await db.from('caregiver_profiles').update({ self_complete: true, axiscare_id: axid,
        about: blank(p.about), experience: blank(p.experience), why_this_work: blank(p.why_this_work), updated_at: now })
        .eq('id', p.id).select(PROFILE_COLS).single()
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, profile: data })
    }
    const { data, error } = await db.from('caregiver_profiles').insert({ axiscare_id: axid, candidate_id: legacy || null, first_name: first,
      last_name: last || null, status: 'new', published: false, consent: false, self_complete: true, updated_at: now }).select(PROFILE_COLS).single()
    if (error) return json({ error: /duplicate|unique/i.test(error.message) ? 'Someone just started their profile. Refresh and try again.' : error.message }, 500)
    return json({ ok: true, profile: data, started: true })
  }

  const id = String(b.profile_id || '')
  if (!UUID.test(id)) return json({ error: 'Which profile?' }, 400)
  const { data: p } = await db.from('caregiver_profiles').select(PROFILE_COLS + ', upload_token').eq('id', id).maybeSingle()
  if (!p) return json({ error: 'That profile was not found.' }, 404)

  if (action === 'send_link') {
    if (p.status === 'withdrawn') return json({ error: 'This profile was withdrawn.' }, 409)
    if (locked(p)) return json({ error: 'Their profile is published, so their own link is locked. To change the photo, use "Replace photo" here, or Unpublish first and then send the link.' }, 409)
    const first = p.preferred_name || p.first_name || 'there'
    const m = (p.self_complete === true ? catchupMessages : linkMessages)(first, profileLink(p.upload_token))
    /* where to send: what the office passed, else their welcome call, else their application */
    let phone = clean(b.phone, 30), email = clean(b.email, 120).toLowerCase()
    if ((!phone || !email) && p.candidate_id) {
      const { data: wc } = await db.from('welcome_calls').select('phone, email').eq('candidate_id', p.candidate_id).order('invited_at', { ascending: false }).limit(1)
      phone = phone || clean(wc?.[0]?.phone, 30); email = email || clean(wc?.[0]?.email, 120).toLowerCase()
    }
    if ((!phone || !email) && p.applicant_id) {
      const { data: a } = await db.from('job_applicants').select('phone, email').eq('id', p.applicant_id).maybeSingle()
      phone = phone || clean(a?.phone, 30); email = email || clean(a?.email, 120).toLowerCase()
    }
    if (b.dry) return json({ ok: true, dry: true, text: m.text, subject: m.subject, html: m.html, to: { phone: phone || null, email: email || null } })
    if (!phone && !email) return json({ error: 'They need a phone number or an email first.' }, 400)

    const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
    const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
    const notSent: string[] = []; let texted = false, emailed = false
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ')
    if (!ghl.token || !ghl.locationId) notSent.push('texting is not set up on the server')
    else {
      if (phone) {
        const c = await latestTextConsent(db, phone)
        if (!inTextHours()) notSent.push('text: texts go 8am to 6pm Central (the email still went)')
        else if (!c.ok) notSent.push('text: ' + c.why)
        else {
          const cid = await ghlContactIfAllowed(db, ghl, 'caregiver-profile', { channel: 'sms', phone, email, firstName: p.first_name, lastName: p.last_name })
          if (!cid) notSent.push('text: they opted out, or the number could not be confirmed')
          else if (!(texted = await ghlSendChecked(db, H, 'caregiver-profile', { channel: 'sms', contactId: cid, address: phone, who: name }, { message: m.text })))
            notSent.push('text: GoHighLevel did not accept it (a card is on Needs Attention)')
        }
      }
      if (email) {
        const cid = await ghlContactIfAllowed(db, ghl, 'caregiver-profile', { channel: 'email', email, phone, firstName: p.first_name, lastName: p.last_name })
        if (!cid) notSent.push('email: they opted out, or the address could not be confirmed')
        else if (!(emailed = await ghlSendChecked(db, H, 'caregiver-profile', { channel: 'email', contactId: cid, address: email, who: name }, { subject: m.subject, html: m.html })))
          notSent.push('email: GoHighLevel did not accept it (a card is on Needs Attention)')
      }
    }
    if (texted || emailed) {
      await db.from('caregiver_profiles').update({ link_sent_at: now, link_sent_by: staff, updated_at: now }).eq('id', id)
      if (p.candidate_id) await db.from('welcome_calls').update({ photo_link_sent: true, updated_at: now })
        .eq('candidate_id', p.candidate_id).in('status', ['invited', 'booked'])
    }
    return json({ ok: true, texted, emailed, not_sent: notSent })
  }

  if (action === 'publish') {
    const fixed = { about: noDash(p.about).trim(), experience: noDash(p.experience).trim(), why_this_work: noDash(p.why_this_work).trim() }
    const problems = publishProblems({ ...p, ...fixed })
    if (problems.length) return json({ ok: false, error: 'Not published yet:\n' + problems.join('\n'), problems }, 409)
    const { error } = await db.from('caregiver_profiles').update({ ...fixed, published: true, status: 'approved', needs_review: false, published_at: now, published_by: staff, updated_at: now }).eq('id', id)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, published: true, card: 'https://cc.mo-care.com/caregiver.html?id=' + id })
  }
  if (action === 'unpublish') {
    const { error } = await db.from('caregiver_profiles').update({ published: false, status: p.status === 'withdrawn' ? 'withdrawn' : 'new', updated_at: now }).eq('id', id)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, published: false })
  }
  return json({ error: 'unknown action' }, 400)
})
