// =============================================================================
// step1-import — the Step 1 application, on their profile (Desktop 458, 2026-10-05). Owner key only.
// =============================================================================
// Samantha: "can you pull 'step 1 application' in from their GHL account and save it into their profiles"; after the 457 look
// she approved what to keep: "yes build it".
// For each Hub caregiver: their GoHighLevel contact (phone, then email; never by name) → the newest file in "Upload Step 1
// Application Packet" → Claude reads it and returns ONLY the approved details → one row in caregiver_application_facts.
//   KEPT:  their own words (interest, qualities, why us, conversation, hobbies), past job titles / dates / duties (no
//          employer, supervisor, pay or reason for leaving), education level, client-matching answers, availability,
//          favorites.
//   NEVER: Social Security or licence numbers, birth date, race, gender, addresses, phones, emails, emergency or reference
//          contacts, prior names, criminal / DUI / driving answers, residence history, tax or I-9 details, signatures.
//   The PDF is NOT stored. A second net here drops any value that looks like an SSN, phone, email, link or long number.
//   mode 'practice' (default): reads, says which groups it found, saves nothing. mode 'live': saves. A PDF already read
//   (same GoHighLevel file) is skipped. { offset, limit } batches so each call stays under the time limit.
// Returns first name + last initial per person and counts only. Every GoHighLevel request is a GET.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string) => ({ Authorization: `Bearer ${tok}`, Version: '2021-07-28', Accept: 'application/json' })
export const FIELD = 'upload step 1 application packet'
export const MODEL = 'claude-sonnet-5-5'          // no temperature setting: this model refuses it (457)
const MAX_BYTES = 25 * 1024 * 1024
export const digits10 = (p: unknown) => { let d = String(p ?? '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d : '' }
export const norm = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/[^\p{L}\p{N}#]+/gu, ' ').toLowerCase().trim()
const short = (f: unknown, l: unknown) => [String(f || '').trim(), String(l || '').trim().slice(0, 1)].filter(Boolean).join(' ') + (String(l || '').trim() ? '.' : '')
// deno-lint-ignore no-explicit-any
type Any = any

export const SERVICES = ['companionship', 'housekeeping', 'errands_shopping', 'meal_preparation', 'laundry', 'transportation', 'activities', 'medication_reminders', 'dementia_care']
export const SHIFTS = ['mornings', 'afternoons', 'evenings', 'overnights', 'live_in', 'weekdays', 'weekends']
export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
export const FAVORITES = ['candy_bar', 'soft_drink', 'snack', 'sandwich', 'food', 'dessert', 'restaurant', 'store', 'music', 'movies', 'sports_team', 'flower', 'gift_card_places']

export const EXTRACT_SYSTEM = `You read a caregiver's job application packet (a filled-in PDF) for Caring Companions, an in-home senior care agency. Copy out ONLY the details listed below, exactly as the caregiver answered. Leave anything not answered out (use null or an empty list). Never guess.

NEVER include, anywhere, even inside another answer: Social Security numbers, driver's licence or ID numbers, birth dates or ages, race, gender, addresses, phone numbers, emails, names of emergency contacts or references or their details, other names they used, criminal, DUI, felony, misdemeanor or traffic answers, where they have lived, tax or W-4 details, I-9 documents, pay or salary, reasons for leaving a job, supervisor names, or the name of any employer, school, client or family member.

Return JSON only, this shape:
{
 "own_words": {"interest": "what interests them in the position and working with the elderly", "qualities": "qualities that would make them a great Caring Companion", "why_us": "why they are interested in working with us", "conversation": "are they comfortable starting and carrying on conversations", "hobbies": "hobbies, special interests, talents"},
 "experience": {"jobs": [{"title": "", "from": "", "to": "", "duties": ""}], "education": {"highest": "grade school | high school | vocational | college", "subject": "", "graduated": "yes | no | null"}},
 "matching": {"services": [one or more of: ${SERVICES.join(', ')}], "hospice": "yes | no | null", "cats": "yes | no | null", "dogs": "yes | no | null", "pets": "yes | no | null", "client_smokes": "yes | no | null", "travel_miles": number or null, "basic_meal": "yes | no | null", "daily_living_help": "yes | with training | no | null", "follows_directions": "yes | no | null", "has_gps": "yes | no | null", "smoker": "yes | no | null"},
 "availability": {"start_date": "as written", "full_or_part": "full-time | part-time | null", "hours_ideal": number or null, "hours_min": number or null, "hours_max": number or null, "shifts": [any of: ${SHIFTS.join(', ')}], "days": {"monday": "from-to as written", "...": ""}, "overnight_days": {"monday": "from-to", "...": ""}},
 "favorites": {${FAVORITES.map((k) => '"' + k + '": ""').join(', ')}}
}
Keep their own words as they wrote them (fix nothing). Job duties: what they did, with no employer, client or place names. Never use an em dash.`

/* ── the second net: whatever the AI returned, only the approved shape and nothing that looks private survives ── */
const PRIVATE = /\b\d{3}-?\d{2}-?\d{4}\b|\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|@|https?:\/\/|\bwww\.|\b\d{5}(?:-\d{4})?\b|\b\d{7,}\b/i
export function txt(v: unknown, n = 600): string | null {
  if (v == null) return null
  const t = String(v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s*[—―]\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, n)
  if (!t || /^(null|n\/a|none|-)$/i.test(t)) return null
  return PRIVATE.test(t) ? null : t
}
const yn = (v: unknown) => { const t = String(v ?? '').toLowerCase().trim(); return t === 'yes' || t === 'no' ? t : t === 'with training' ? 'with training' : null }
const num = (v: unknown, max: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : null }
const pick = (v: unknown, allowed: string[]) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).toLowerCase().trim().replace(/[\s/-]+/g, '_')).filter((x) => allowed.includes(x)))]
const dayMap = (v: Any) => { const o: Record<string, string> = {}; for (const d of DAYS) { const t = txt(v?.[d], 40); if (t && !/\d{3,}/.test(t.replace(/\d{1,2}:\d{2}/g, ''))) o[d] = t } return o }
export function cleanFacts(raw: unknown): Any {
  let o: Any = raw
  if (typeof raw === 'string') { const t = raw.replace(/```(?:json)?/gi, ''); const s = t.indexOf('{'), e = t.lastIndexOf('}'); try { o = s >= 0 && e > s ? JSON.parse(t.slice(s, e + 1)) : {} } catch { o = {} } }
  o = o && typeof o === 'object' ? o : {}
  const w = o.own_words || {}, x = o.experience || {}, m = o.matching || {}, a = o.availability || {}, f = o.favorites || {}
  const out: Any = {
    own_words: { interest: txt(w.interest), qualities: txt(w.qualities), why_us: txt(w.why_us), conversation: txt(w.conversation, 200), hobbies: txt(w.hobbies, 400) },
    experience: {
      jobs: (Array.isArray(x.jobs) ? x.jobs : []).slice(0, 6).map((j: Any) => ({ title: txt(j?.title, 80), from: txt(j?.from, 20), to: txt(j?.to, 20), duties: txt(j?.duties, 400) })).filter((j: Any) => j.title || j.duties),
      education: { highest: txt(x.education?.highest, 40), subject: txt(x.education?.subject, 80), graduated: yn(x.education?.graduated) },
    },
    matching: { services: pick(m.services, SERVICES), hospice: yn(m.hospice), cats: yn(m.cats), dogs: yn(m.dogs), pets: yn(m.pets), client_smokes: yn(m.client_smokes),
      travel_miles: num(m.travel_miles, 500), basic_meal: yn(m.basic_meal), daily_living_help: yn(m.daily_living_help), follows_directions: yn(m.follows_directions), has_gps: yn(m.has_gps), smoker: yn(m.smoker) },
    availability: { start_date: txt(a.start_date, 40), full_or_part: /^(full-time|part-time)$/i.test(String(a.full_or_part ?? '')) ? String(a.full_or_part).toLowerCase() : null,
      hours_ideal: num(a.hours_ideal, 100), hours_min: num(a.hours_min, 100), hours_max: num(a.hours_max, 100), shifts: pick(a.shifts, SHIFTS), days: dayMap(a.days), overnight_days: dayMap(a.overnight_days) },
    favorites: Object.fromEntries(FAVORITES.map((k) => [k, txt(f[k], 120)])),
  }
  return out
}
/* 458b: does the reply hold a JSON object at all (yes/no only) */
export function parsedOk(raw: string): boolean {
  const t = String(raw || '').replace(/```(?:json)?/gi, ''); const s = t.indexOf('{'), e = t.lastIndexOf('}')
  try { return s >= 0 && e > s && typeof JSON.parse(t.slice(s, e + 1)) === 'object' } catch { return false }
}
/* the reply's top-level key NAMES only (to see a shape mismatch), never values */
export function topKeys(raw: string): string {
  const t = String(raw || '').replace(/```(?:json)?/gi, ''); const s = t.indexOf('{'), e = t.lastIndexOf('}')
  try { const o = JSON.parse(t.slice(s, e + 1)); return Object.keys(o || {}).slice(0, 8).map((k) => k.replace(/[^\w ]/g, '').slice(0, 24)).join(',') } catch { return '' }
}
export const total = (g: Any) => Object.values(g || {}).reduce((a: number, v: Any) => a + (Number(v) || 0), 0)
/* how full each group is (counts only, for the report) */
export function groupsFilled(fx: Any) {
  const n = (o: Any) => Object.values(o || {}).filter((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)).length
  return { own_words: n(fx.own_words), jobs: fx.experience.jobs.length, matching: n(fx.matching), availability: n(fx.availability), favorites: n(fx.favorites) }
}
// deno-lint-ignore no-explicit-any
export function newestFile(v: any): { url: string; key: string } | null {
  if (!v || typeof v !== 'object') return null
  if (typeof v.url === 'string') return { url: v.url, key: String(v.documentId || v.url) }
  const list = Object.entries(v).filter(([, f]: [string, Any]) => f && typeof f === 'object' && typeof f.url === 'string') as [string, Any][]
  return list.length ? { url: list[list.length - 1][1].url, key: list[list.length - 1][0] } : null
}

Deno.serve(async (req) => {
  if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('auth_check') === '1') return json({ ok: true, caller: 'owner' })
  const b: Any = await req.json().catch(() => ({}))
  const live = b.mode === 'live'
  const offset = Math.max(0, Number(b.offset) || 0), limit = Math.min(3, Math.max(1, Number(b.limit) || 2))
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', loc = Deno.env.get('GHL_LOCATION_ID') || '', key = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!tok || !loc) return json({ error: 'GoHighLevel key or location missing' })
  if (!key) return json({ error: 'the AI key is missing' })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const cf = await fetch(`${GHL}/locations/${encodeURIComponent(loc)}/customFields`, { headers: H(tok) })
  if (!cf.ok) return json({ error: `GoHighLevel refused the contact fields list (${cf.status})` })
  const field = ((await cf.json())?.customFields || []).find((f: Any) => norm(f.name) === FIELD)
  if (!field) return json({ error: 'GoHighLevel has no field called "Upload Step 1 Application Packet"' })

  const { data } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  const cgs: Any[] = (Array.isArray(data?.data) ? data!.data : []).filter((g: Any) => g && g.id != null)
  const slice = cgs.slice(offset, offset + limit)
  /* 458b: a record whose details came back empty (the first run) is NOT done: read it again */
  const { data: have } = await db.from('caregiver_application_facts').select('hub_caregiver_id, ghl_file_key, facts')
  const done = new Map((have ?? []).filter((r: Any) => total(groupsFilled(cleanFacts(r.facts || {}))) > 0).map((r: Any) => [String(r.hub_caregiver_id), String(r.ghl_file_key || '')]))
  const rows: Any[] = []
  for (const g of slice) {
    const row: Any = { who: short(g.first, g.last) }; rows.push(row)
    const ph = digits10(g.phone || g.mobile), em = String(g.email || '').trim().toLowerCase()
    if (!ph && !em) { row.state = 'no phone or email in the Hub'; continue }
    let cid = ''
    for (const q of [ph ? `number=${encodeURIComponent('+1' + ph)}` : '', em ? `email=${encodeURIComponent(em)}` : ''].filter(Boolean)) {
      try { const s = await fetch(`${GHL}/contacts/search/duplicate?locationId=${encodeURIComponent(loc)}&${q}`, { headers: H(tok) }); if (s.ok) cid = String((await s.json())?.contact?.id || '') } catch { /* next */ }
      if (cid) break
    }
    if (!cid) { row.state = 'not found in GoHighLevel'; continue }
    const c = await fetch(`${GHL}/contacts/${cid}`, { headers: H(tok) })
    const v = c.ok ? ((await c.json())?.contact?.customFields || []).find((x: Any) => String(x.id) === String(field.id)) : null
    const f = newestFile(v?.value)
    if (!f) { row.state = 'no Step 1 PDF in GoHighLevel'; continue }
    if (done.get(String(g.id)) === f.key) { row.state = 'already read'; continue }
    try {
      const d = await fetch(f.url)
      const type = (d.headers.get('content-type') || '').split(';')[0].trim()
      if (!d.ok || !/pdf/i.test(type)) { row.state = `not read (${d.status} ${type || 'unknown type'})`; await d.body?.cancel(); continue }
      const buf = new Uint8Array(await d.arrayBuffer())
      if (buf.byteLength > MAX_BYTES) { row.state = 'not read (over 25 MB)'; continue }
      let b64 = ''; for (let i = 0; i < buf.length; i += 0x8000) b64 += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 12000, system: EXTRACT_SYSTEM,
          messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: btoa(b64) } },
            { type: 'text', text: 'Copy out only the approved details, as JSON.' }] }] }) })
      if (!r.ok) { const e: Any = await r.json().catch(() => ({})); row.state = `the AI could not read it (${r.status}: ${String(e?.error?.message || '').replace(/\d{3,}/g, '#').slice(0, 120)})`; continue }
      /* 458b: the first run read content[0] only. Take every text block, and say the answer's SHAPE (never its words). */
      const rj: Any = await r.json()
      const blocks: Any[] = Array.isArray(rj?.content) ? rj.content : []
      const text = blocks.filter((x) => x?.type === 'text').map((x) => String(x.text || '')).join('\n')
      const fx = cleanFacts(text)
      row.found = groupsFilled(fx)
      row.shape = { stop: String(rj?.stop_reason || ''), blocks: blocks.map((x) => String(x?.type || '?')).join('+'), chars: text.length, parsed: parsedOk(text), keys: topKeys(text), out_tokens: Number(rj?.usage?.output_tokens) || 0 }
      if (total(row.found) === 0) { row.state = 'read, but nothing came out (see shape)'; continue }
      if (!live) { row.state = 'would save'; continue }
      const { error } = await db.from('caregiver_application_facts').upsert({ hub_caregiver_id: String(g.id), axiscare_id: g.axiscare_id ? String(g.axiscare_id) : null,
        candidate_id: g.candidate_id != null && g.candidate_id !== '' ? String(g.candidate_id) : null, ghl_contact_id: cid, ghl_file_key: f.key,
        first_name: String(g.first || '').trim() || null, facts: fx, extracted_at: new Date().toISOString(), extracted_by: 'step1-import' }, { onConflict: 'hub_caregiver_id' })
      row.state = error ? 'not saved: ' + error.message.slice(0, 80) : 'saved'
    } catch (e) { row.state = 'failed: ' + String((e as Error)?.message || e).slice(0, 80) }
  }
  return json({ ok: true, live, total: cgs.length, offset, next: offset + limit < cgs.length ? offset + limit : null, people: rows })
})
