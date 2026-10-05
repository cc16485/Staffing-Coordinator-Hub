// =============================================================================
// step1-look — READ ONLY, TEMPORARY (Desktop 457, 2026-10-05). Writes nothing, anywhere. Owner key only. Deleted after use.
// =============================================================================
// Samantha: "can you pull 'step 1 application' in from their GHL account and save it into their profiles"; "youll have to
// extract a lot of info from that step 1 application pdf"; "yes build it" (to this look first).
// The PDF is the GoHighLevel file field "Upload Step 1 Application Packet" (42 caregivers had one on 2026-10-01). Before
// anything is imported she picks what to keep, so this answers ONE question: what does that form ask?
//   · finds up to LOOK_MAX Hub caregivers whose GoHighLevel contact has that file (matched by phone, then email; never name)
//   · downloads the newest file, has Claude list the form's sections and question LABELS only
//   · returns: how many caregivers have one, each file's page count and type, and the labels. NEVER an answer, a name,
//     a number, an email, an id, a link or the file itself. A label that looks like it carries an answer is dropped.
// Every GoHighLevel request is a GET. The PDF goes to Anthropic (BAA signed 2026-09-28) and nowhere else; nothing is stored.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string) => ({ Authorization: `Bearer ${tok}`, Version: '2021-07-28', Accept: 'application/json' })
export const FIELD = 'upload step 1 application packet'
export const LOOK_MAX = 2
const MAX_BYTES = 20 * 1024 * 1024
export const digits10 = (p: unknown) => { let d = String(p ?? '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d : '' }
export const norm = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/[^\p{L}\p{N}#]+/gu, ' ').toLowerCase().trim()

export const LOOK_SYSTEM = `You are shown a blank-form question: what does this job application form ask? It is a filled-in caregiver job application packet, but you must report ONLY the form's structure, never what anyone wrote.

Return the form's sections in order, and under each section the labels of the questions or fields, exactly as printed on the form (for example "Date of Birth", "Have you ever been convicted of a crime?", "Years of caregiving experience", "Languages spoken").

Never include anything filled in: no names, dates, numbers, addresses, phone numbers, emails, answers, checked boxes, signatures or handwriting. If you are unsure whether text is a label or an answer, leave it out.

Reply with JSON only: {"pages": <number>, "sections": [{"title": "...", "labels": ["...", "..."]}]}`

/* A label that carries what looks like an answer (an email, a long number, a date) is dropped, never shown. */
export function safeLabel(s: unknown): string | null {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!t) return null
  if (/@|\d{3,}|\d{1,2}\/\d{1,2}\/\d{2,4}|https?:\/\//i.test(t)) return null
  return t
}
// deno-lint-ignore no-explicit-any
export function cleanLook(raw: string): { pages: number; sections: Array<{ title: string; labels: string[] }> } {
  // deno-lint-ignore no-explicit-any
  let o: any = {}
  try { const s = raw.indexOf('{'), e = raw.lastIndexOf('}'); o = s >= 0 && e > s ? JSON.parse(raw.slice(s, e + 1)) : {} } catch { o = {} }
  const sections = (Array.isArray(o.sections) ? o.sections : []).slice(0, 60).map((x: any) => ({
    title: safeLabel(x?.title) || '(untitled section)',
    labels: (Array.isArray(x?.labels) ? x.labels : []).map(safeLabel).filter(Boolean).slice(0, 80) as string[],
  }))
  return { pages: Math.max(0, Math.min(200, Number(o.pages) || 0)), sections }
}
/* the newest file inside one GoHighLevel file-field value */
// deno-lint-ignore no-explicit-any
export function newestFile(v: any): { url: string } | null {
  if (!v || typeof v !== 'object') return null
  if (typeof v.url === 'string') return { url: v.url }
  const list = Object.values(v).filter((f: any) => f && typeof f === 'object' && typeof f.url === 'string') as Array<{ url: string }>
  return list.length ? list[list.length - 1] : null
}

Deno.serve(async (req) => {
  if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('auth_check') === '1') return json({ ok: true, caller: 'owner' })
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', loc = Deno.env.get('GHL_LOCATION_ID') || ''
  const key = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!tok || !loc) return json({ error: 'GoHighLevel key or location missing' })
  if (!key) return json({ error: 'the AI key is missing' })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const cf = await fetch(`${GHL}/locations/${encodeURIComponent(loc)}/customFields`, { headers: H(tok) })
  if (!cf.ok) return json({ error: `GoHighLevel refused the contact fields list (${cf.status})` })
  // deno-lint-ignore no-explicit-any
  const field = ((await cf.json())?.customFields || []).find((f: any) => norm(f.name) === FIELD)
  if (!field) return json({ error: 'GoHighLevel has no field called "Upload Step 1 Application Packet"' })

  const { data } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cgs: any[] = Array.isArray(data?.data) ? data!.data : []
  const out = { ok: true, caregivers: cgs.length, looked_up: 0, with_file: 0, files: [] as unknown[], sections: [] as Array<{ title: string; labels: string[] }> }
  const seen = new Map<string, Set<string>>()
  for (const g of cgs) {
    if (out.files.length >= LOOK_MAX) break
    const ph = digits10(g.phone || g.mobile), em = String(g.email || '').trim().toLowerCase()
    if (!ph && !em) continue
    out.looked_up++
    let cid = ''
    for (const q of [ph ? `number=${encodeURIComponent('+1' + ph)}` : '', em ? `email=${encodeURIComponent(em)}` : ''].filter(Boolean)) {
      try { const s = await fetch(`${GHL}/contacts/search/duplicate?locationId=${encodeURIComponent(loc)}&${q}`, { headers: H(tok) }); if (s.ok) cid = String((await s.json())?.contact?.id || '') } catch { /* next */ }
      if (cid) break
    }
    if (!cid) continue
    const c = await fetch(`${GHL}/contacts/${cid}`, { headers: H(tok) })
    // deno-lint-ignore no-explicit-any
    const v = c.ok ? ((await c.json())?.contact?.customFields || []).find((x: any) => String(x.id) === String(field.id)) : null
    const f = newestFile(v?.value); if (!f) continue
    out.with_file++
    const d = await fetch(f.url)
    const type = (d.headers.get('content-type') || '').split(';')[0].trim()
    if (!d.ok || !/pdf/i.test(type)) { out.files.push({ result: `not read (${d.status} ${type || 'unknown type'})` }); await d.body?.cancel(); continue }
    const buf = new Uint8Array(await d.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) { out.files.push({ result: 'not read (over 20 MB)' }); continue }
    let b64 = ''; for (let i = 0; i < buf.length; i += 0x8000) b64 += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 4000, temperature: 0, system: LOOK_SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: btoa(b64) } },
          { type: 'text', text: 'List the sections and question labels of this form. Labels only, never answers.' }] }] }) })
    /* 457b: the first run got a bare 400 twice. Say why (the AI's own reason, numbers and links scrubbed) and the size. */
    if (!r.ok) {
      // deno-lint-ignore no-explicit-any
      const e: any = await r.json().catch(() => ({}))
      const why = String(e?.error?.message || e?.error?.type || '').replace(/https?:\/\/\S+/g, '(link)').replace(/\d{3,}/g, '#').slice(0, 220)
      out.files.push({ result: `the AI could not read it (${r.status}${why ? ': ' + why : ''})`, kb: Math.round(buf.byteLength / 1024), head: new TextDecoder().decode(buf.subarray(0, 8)).replace(/[^\x20-\x7e]/g, '?') })
      continue
    }
    const look = cleanLook(String((await r.json())?.content?.[0]?.text ?? ''))
    out.files.push({ result: 'read', kb: Math.round(buf.byteLength / 1024), pages: look.pages, sections: look.sections.length })
    for (const s of look.sections) { const set = seen.get(s.title) ?? new Set<string>(); s.labels.forEach((l) => set.add(l)); seen.set(s.title, set) }
  }
  out.sections = [...seen.entries()].map(([title, set]) => ({ title, labels: [...set] }))
  return json(out)
})
