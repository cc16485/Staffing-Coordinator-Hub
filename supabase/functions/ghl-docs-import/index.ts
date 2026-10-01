// =============================================================================
// ghl-docs-import — pre-hire proofs from GoHighLevel into the Hub (Desktop 381, 2026-10-01). Owner key only.
// =============================================================================
// Samantha approved ("yes to all"): copy each caregiver's / candidate's GHL uploads for EDL, OIG, FCSR, Checkr (plus
// the matching RESULTS option) and the professional/personal reference-check uploads into the Hub's private storage,
// one prehire_docs row per file. Never touches any other field (no Social Security cards, birth certificates, I-9s).
//   • Matching: Hub record → GHL contact by phone (last 10 digits), else email. Never by name.
//   • Never overwrites: the Hub's own records are not written at all; the Hub shows an imported file only where it has
//     none of its own. Re-runs skip files already imported (ghl_file_key).
//   • mode 'practice' (default): reads only, says what it would import. mode 'live': downloads + stores.
//   • Batches: { offset, limit } over (Hub caregivers, then open candidates), so each call stays under the time limit.
// Every GoHighLevel request is a GET. Returns first name + last initial per person, check names, counts.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string) => ({ Authorization: `Bearer ${tok}`, Version: '2021-07-28', Accept: 'application/json' })
export const digits10 = (p: unknown) => { let d = String(p ?? '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d : '' }
export const norm = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/[^\p{L}\p{N}#]+/gu, ' ').toLowerCase().trim()
/* exact field names (after norm) → what they are */
export const FILE_FIELDS: Record<string, string> = {
  'upload edl': 'edl', 'upload oig': 'oig', 'upload fcsr': 'fcsr', 'upload checkr background screening': 'checkr',
  'upload professional reference check #1': 'ref_pro_1', 'upload professional reference check #2': 'ref_pro_2',
  'upload professional reference check #3': 'ref_pro_3', 'upload personal reference #1': 'ref_personal_1', 'upload personal reference #2': 'ref_personal_2',
}
export const RESULT_FIELDS: Record<string, string> = { 'edl results': 'edl', 'oig results': 'oig', 'fcsr results': 'fcsr', 'checkr results': 'checkr' }
const MAX_BYTES = 20 * 1024 * 1024
const OK_TYPES = /^(application\/pdf|image\/(jpeg|png|heic|heif|webp))/i
const short = (f: unknown, l: unknown) => [String(f || '').trim(), String(l || '').trim().slice(0, 1)].filter(Boolean).join(' ') + (String(l || '').trim() ? '.' : '')

/* the files inside one GHL file-field value: [{key, url, name}] (newest last, as GHL lists them) */
// deno-lint-ignore no-explicit-any
export function filesIn(v: any): Array<{ key: string; url: string; name: string }> {
  const out: Array<{ key: string; url: string; name: string }> = []
  if (!v || typeof v !== 'object') return out
  if (typeof v.url === 'string') { out.push({ key: String(v.documentId || v.url), url: v.url, name: String(v.meta?.originalname || v.meta?.name || '') }); return out }
  for (const [k, x] of Object.entries(v)) {
    // deno-lint-ignore no-explicit-any
    const f: any = x
    if (f && typeof f === 'object' && typeof f.url === 'string') out.push({ key: k, url: f.url, name: String(f.meta?.originalname || f.meta?.name || f.name || '') })
  }
  return out
}

Deno.serve(async (req) => {
  if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const live = b.mode === 'live'
  const offset = Math.max(0, Number(b.offset) || 0), limit = Math.min(12, Math.max(1, Number(b.limit) || 8))
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!tok || !loc) return json({ error: 'GoHighLevel key or location missing' }, 500)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const cf = await fetch(`${GHL}/locations/${encodeURIComponent(loc)}/customFields`, { headers: H(tok) })
  if (!cf.ok) return json({ error: `GoHighLevel refused the contact fields list (${cf.status}). The token needs Custom Fields (read).` }, 200)
  // deno-lint-ignore no-explicit-any
  const fields: any[] = (await cf.json())?.customFields || []
  const fileId: Record<string, string> = {}, resultId: Record<string, string> = {}
  for (const f of fields) { const n = norm(f.name); if (FILE_FIELDS[n]) fileId[String(f.id)] = FILE_FIELDS[n]; if (RESULT_FIELDS[n]) resultId[String(f.id)] = RESULT_FIELDS[n] }
  const found = [...new Set(Object.values(fileId))]

  const key = async (k: string) => { const { data } = await db.from('app_data').select('data').eq('key', k).maybeSingle(); return Array.isArray(data?.data) ? data!.data : [] }
  // deno-lint-ignore no-explicit-any
  const cgs: any[] = await key('caregivers'), cands: any[] = (await key('candidates')).filter((c: any) => c && !c.not_hired && !c.closed_out)
  // deno-lint-ignore no-explicit-any
  const people: any[] = [...cgs.map((g) => ({ kind: 'caregiver', r: g })), ...cands.map((c) => ({ kind: 'candidate', r: c }))]
  const slice = people.slice(offset, offset + limit)
  const { data: already } = await db.from('prehire_docs').select('person_kind, person_id, check_key, ghl_file_key')
  const have = new Set((already ?? []).map((x: { person_kind: string; person_id: string; check_key: string; ghl_file_key: string }) => `${x.person_kind}|${x.person_id}|${x.check_key}|${x.ghl_file_key}`))

  const rows: unknown[] = []
  for (const p of slice) {
    const r = p.r, pid = String(r.id), ph = digits10(r.phone || r.mobile), em = String(r.email || '').trim().toLowerCase()
    const row: Record<string, unknown> = { kind: p.kind, who: short(r.first, r.last), matched: false, checks: [] as unknown[] }
    rows.push(row)
    let cid = ''
    try {
      for (const q of [ph ? `number=${encodeURIComponent('+1' + ph)}` : '', em ? `email=${encodeURIComponent(em)}` : ''].filter(Boolean)) {
        const s = await fetch(`${GHL}/contacts/search/duplicate?locationId=${encodeURIComponent(loc)}&${q}`, { headers: H(tok) })
        if (s.ok) cid = String((await s.json())?.contact?.id || '')
        if (cid) break
      }
    } catch { /* not found */ }
    if (!cid) { row.why = ph || em ? 'not found in GoHighLevel by phone or email' : 'no phone or email in the Hub'; continue }
    row.matched = true
    const c = await fetch(`${GHL}/contacts/${cid}`, { headers: H(tok) })
    // deno-lint-ignore no-explicit-any
    const vals: any[] = c.ok ? ((await c.json())?.contact?.customFields || []) : []
    const results: Record<string, string> = {}
    for (const v of vals) { const k = resultId[String(v.id)]; if (k && v.value) results[k] = String(v.value).slice(0, 80) }
    for (const v of vals) {
      const k = fileId[String(v.id)]; if (!k) continue
      const files = filesIn(v.value); if (!files.length) continue
      const f = files[files.length - 1]
      const hubHas = ['edl', 'oig', 'fcsr'].includes(k)
        ? !!(r.prehire?.[k]?.proof || r[`${k}_proof`]) : false
      const ck: Record<string, unknown> = { check: k, hub_has_doc: hubHas, result: results[k] || '' }
      ;(row.checks as unknown[]).push(ck)
      if (have.has(`${p.kind}|${pid}|${k}|${f.key}`)) { ck.state = 'already imported'; continue }
      if (!live) { ck.state = 'would import'; continue }
      try {
        const d = await fetch(f.url)
        const type = (d.headers.get('content-type') || '').split(';')[0].trim()
        if (!d.ok || !OK_TYPES.test(type)) { ck.state = `skipped (${d.status} ${type || 'unknown type'})`; await d.body?.cancel(); continue }
        const buf = new Uint8Array(await d.arrayBuffer())
        if (buf.byteLength > MAX_BYTES) { ck.state = 'skipped (over 20 MB)'; continue }
        const ext = type.includes('pdf') ? 'pdf' : type.split('/')[1].replace('jpeg', 'jpg')
        const path = `bgcheck/ghl/${p.kind}-${pid}/${k}-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.${ext}`
        const up = await db.storage.from('lead-docs').upload(path, buf, { contentType: type, upsert: false })
        if (up.error) { ck.state = 'failed to store: ' + up.error.message.slice(0, 60); continue }
        const ins = await db.from('prehire_docs').insert({ person_kind: p.kind, person_id: pid, axiscare_id: r.axiscare_id ? String(r.axiscare_id) : null,
          person_name: [r.first, r.last].filter(Boolean).join(' '), check_key: k, storage_path: path, content_type: type,
          result_text: results[k] || null, ghl_contact_id: cid, ghl_field: Object.keys(FILE_FIELDS).find((n) => FILE_FIELDS[n] === k) || '', ghl_file_key: f.key })
        if (ins.error) { await db.storage.from('lead-docs').remove([path]); ck.state = 'failed to record: ' + ins.error.message.slice(0, 60); continue }
        ck.state = 'imported'
      } catch (e) { ck.state = 'failed: ' + String((e as Error)?.message || e).slice(0, 60) }
    }
  }
  return json({ ok: true, live, total_people: people.length, offset, next: offset + limit < people.length ? offset + limit : null,
    fields_found: found, people: rows })
})
