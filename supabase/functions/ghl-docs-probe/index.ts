// =============================================================================
// ghl-docs-probe — READ ONLY, TEMPORARY (Desktop 378, 2026-10-01). Writes nothing, anywhere. Owner key only.
// =============================================================================
// Question (hers): the pre-hire proofs (EDL, FCSR, OIG, fingerprints...) are mostly uploaded on each caregiver's
// GoHighLevel profile. Can the Hub pull them, and from where? This looks, for the Hub's caregivers only, at:
//   1. the location's FILE custom fields (names + how many caregivers have each filled),
//   2. whether a stored file can be downloaded with the Hub's key (status + type only, never the content),
//   3. notes that carry document links, 4. conversation attachments, 5. the media library's permission.
// Returns field names, counts and status codes only: never names, numbers, emails, ids, URLs or file contents.
// Every GoHighLevel request is a GET (or a HEAD/ranged GET on one sample file per field). 378 deletes this after one use.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string, v = '2021-07-28') => ({ Authorization: `Bearer ${tok}`, Version: v, Accept: 'application/json' })
const digits10 = (p: unknown) => { let d = String(p ?? '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d : '' }
const DOCWORDS = /(edl|fcsr|oig|finger|background|bgc|reference|license|tb|cpr|i-?9|w-?4|pre-?hire|check)/i
// deno-lint-ignore no-explicit-any
function urlsIn(v: any): string[] {
  const out: string[] = []
  const walk = (x: unknown) => {
    if (typeof x === 'string') { if (/^https?:\/\//i.test(x)) out.push(x) }
    else if (Array.isArray(x)) x.forEach(walk)
    else if (x && typeof x === 'object') Object.values(x as Record<string, unknown>).forEach(walk)
  }
  walk(v); return out
}
// deno-lint-ignore no-explicit-any
function shapeOf(v: any): string {
  if (v == null) return 'empty'
  if (typeof v === 'string') return /^https?:/i.test(v) ? 'link text' : 'text'
  if (Array.isArray(v)) return 'list of ' + (v.length ? shapeOf(v[0]) : 'nothing')
  if (typeof v === 'object') return 'object{' + Object.keys(v).slice(0, 4).map((k) => /^[0-9a-f-]{20,}$/i.test(k) ? '<file id>' : k).join(',') + '}'
  return typeof v
}

Deno.serve(async (req) => {
  if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!tok || !loc) return json({ error: 'GoHighLevel key or location missing' }, 500)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  /* 1 · the file-type custom fields */
  const cf = await fetch(`${GHL}/locations/${encodeURIComponent(loc)}/customFields`, { headers: H(tok) })
  // deno-lint-ignore no-explicit-any
  const fieldsAll: any[] = cf.ok ? ((await cf.json())?.customFields || []) : []
  const isFile = (f: { dataType?: string }) => /FILE|SIGNATURE|UPLOAD/i.test(String(f.dataType || ''))
  const fileFields = fieldsAll.filter(isFile).map((f) => ({ id: String(f.id), name: String(f.name || ''), type: String(f.dataType || ''), filled: 0, sample: '' as string, shape: '' }))
  const docLikeText = fieldsAll.filter((f) => !isFile(f) && DOCWORDS.test(String(f.name || ''))).map((f) => ({ name: String(f.name), type: String(f.dataType) }))

  /* the Hub's caregivers: phones and emails only, to find their GoHighLevel contacts */
  const { data: row } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cgs: any[] = Array.isArray(row?.data) ? row!.data : []
  const active = cgs.filter((c) => c && c.not_hired !== true)
  const out = { custom_fields_answer: cf.status, file_fields: [] as unknown[], doc_like_text_fields: docLikeText, hub_caregivers: active.length,
    matched_in_ghl: 0, no_phone_or_email: 0, not_found: 0, with_any_file_field: 0, notes: { caregivers_with_doc_links: 0, doc_link_notes: 0, answer: 0 },
    conversations: { checked: 0, with_pdf_or_image_attachments: 0, attachments: 0 }, media_library_answer: 0, download_tests: [] as unknown[] }

  for (const c of active) {
    const ph = digits10(c.phone || c.mobile), em = String(c.email || '').trim().toLowerCase()
    if (!ph && !em) { out.no_phone_or_email++; continue }
    let cid = ''
    try {
      const q = ph ? `number=${encodeURIComponent('+1' + ph)}` : `email=${encodeURIComponent(em)}`
      const r = await fetch(`${GHL}/contacts/search/duplicate?locationId=${encodeURIComponent(loc)}&${q}`, { headers: H(tok) })
      if (r.ok) cid = String((await r.json())?.contact?.id || '')
      if (!cid && ph && em) {
        const r2 = await fetch(`${GHL}/contacts/search/duplicate?locationId=${encodeURIComponent(loc)}&email=${encodeURIComponent(em)}`, { headers: H(tok) })
        if (r2.ok) cid = String((await r2.json())?.contact?.id || '')
      }
    } catch { /* counted as not found */ }
    if (!cid) { out.not_found++; continue }
    out.matched_in_ghl++
    try {
      const r = await fetch(`${GHL}/contacts/${cid}`, { headers: H(tok) })
      if (r.ok) {
        // deno-lint-ignore no-explicit-any
        const ct: any = (await r.json())?.contact || {}
        // deno-lint-ignore no-explicit-any
        const vals: any[] = ct.customFields || ct.customField || []
        let any = false
        for (const f of fileFields) {
          const v = vals.find((x) => String(x.id) === f.id)
          const val = v ? (v.value ?? v.fieldValue ?? v.field_value) : null
          if (val && (typeof val !== 'string' || val.trim())) { f.filled++; any = true; if (!f.shape) f.shape = shapeOf(val); if (!f.sample) f.sample = urlsIn(val)[0] || '' }
        }
        if (any) out.with_any_file_field++
      }
    } catch { /* skip */ }
    try {
      const r = await fetch(`${GHL}/contacts/${cid}/notes`, { headers: H(tok) }); out.notes.answer = r.status
      if (r.ok) {
        // deno-lint-ignore no-explicit-any
        const notes: any[] = (await r.json())?.notes || []
        const docNotes = notes.filter((n) => /https?:\/\//i.test(String(n.body || '')) && (DOCWORDS.test(String(n.body || '')) || /\.pdf/i.test(String(n.body || ''))))
        if (docNotes.length) { out.notes.caregivers_with_doc_links++; out.notes.doc_link_notes += docNotes.length }
      }
    } catch { /* skip */ }
    if (out.conversations.checked < 25) {
      try {
        const s = await fetch(`${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&contactId=${cid}&limit=1`, { headers: H(tok, '2021-04-15') })
        const conv = s.ok ? ((await s.json())?.conversations || [])[0] : null
        if (conv) {
          out.conversations.checked++
          const m = await fetch(`${GHL}/conversations/${conv.id}/messages?limit=100`, { headers: H(tok, '2021-04-15') })
          const b = m.ok ? await m.json() : {}
          // deno-lint-ignore no-explicit-any
          const msgs: any[] = b?.messages?.messages || b?.messages || []
          const att = msgs.flatMap((x) => Array.isArray(x.attachments) ? x.attachments : []).filter((u: string) => /\.(pdf|png|jpe?g|heic)(\?|$)/i.test(String(u)))
          if (att.length) { out.conversations.with_pdf_or_image_attachments++; out.conversations.attachments += att.length }
        }
      } catch { /* skip */ }
    }
  }

  /* 2 · can a stored file be downloaded? one sample per field; status and type only */
  for (const f of fileFields) {
    if (!f.sample) continue
    const t: Record<string, unknown> = { field: f.name }
    try { const a = await fetch(f.sample, { method: 'GET', headers: { Range: 'bytes=0-0' } }); t.without_key = a.status; t.type = a.headers.get('content-type') || ''; await a.body?.cancel() } catch { t.without_key = 'failed' }
    try { const a = await fetch(f.sample, { method: 'GET', headers: { Range: 'bytes=0-0', Authorization: `Bearer ${tok}` } }); t.with_key = a.status; await a.body?.cancel() } catch { t.with_key = 'failed' }
    t.host = (() => { try { return new URL(f.sample).host } catch { return '' } })()
    out.download_tests.push(t)
  }
  out.file_fields = fileFields.map((f) => ({ name: f.name, type: f.type, caregivers_with_it: f.filled, stored_as: f.shape || '(none filled)' }))
  /* 5 · the media library */
  try { const m = await fetch(`${GHL}/medias/files?altId=${encodeURIComponent(loc)}&altType=location&limit=1&sortBy=createdAt&sortOrder=desc&type=file`, { headers: H(tok) }); out.media_library_answer = m.status; await m.body?.cancel() } catch { /* 0 */ }
  return json({ ok: true, ...out })
})
