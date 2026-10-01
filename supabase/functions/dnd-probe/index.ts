// =============================================================================
// dnd-probe — READ ONLY, TEMPORARY (Desktop 382, 2026-10-01). Writes nothing. Owner key only.
// =============================================================================
// Why does the opt-out door refuse with "could not check GHL Do Not Disturb"? For up to 8 recently refused addresses
// (from contact_send_refusal), repeat exactly what the door does with the CURRENT key: upsert answer, then GET the
// contact, and report only which DND fields GoHighLevel's answers contain (and their types) and the HTTP statuses.
// The upsert is the same call every sender already makes (it only creates a contact if none exists); no message is sent.
// Never returns names, numbers, emails or ids.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
const shape = (c: any) => c ? ({ has_dnd_key: Object.prototype.hasOwnProperty.call(c, 'dnd'), dnd_type: typeof c.dnd, has_dndSettings: !!c.dndSettings && typeof c.dndSettings === 'object',
  dndSettings_channels: c.dndSettings && typeof c.dndSettings === 'object' ? Object.keys(c.dndSettings).sort() : [], has_id: !!c.id }) : null
Deno.serve(async (req) => {
  if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tok = Deno.env.get('GHL_TOKEN') || '', loc = Deno.env.get('GHL_LOCATION_ID') || ''
  const { data: refs } = await db.from('contact_send_refusal').select('channel, address, reasons, at').order('at', { ascending: false }).limit(200)
  const seen = new Set<string>(); const pick: Array<{ channel: string; address: string }> = []
  for (const r of refs ?? []) { const k = r.channel + '|' + r.address; if (seen.has(k)) continue; seen.add(k)
    if (JSON.stringify(r.reasons).includes('could not check GHL Do Not Disturb')) pick.push({ channel: r.channel, address: r.address }); if (pick.length >= 8) break }
  const h = { Authorization: `Bearer ${tok}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const out = []
  for (const p of pick) {
    const body = { locationId: loc, ...(p.channel === 'sms' ? { phone: p.address } : { email: p.address }) }
    const u = await fetch('https://services.leadconnectorhq.com/contacts/upsert', { method: 'POST', headers: h, body: JSON.stringify(body) })
    const uj = await u.json().catch(() => ({}))
    const c = uj?.contact ?? null
    let g = 0, gc = null
    if (c?.id) { const r = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(c.id)}`, { headers: h }); g = r.status; const gj = await r.json().catch(() => ({})); gc = gj?.contact ?? null }
    out.push({ channel: p.channel, upsert_status: u.status, upsert_answer: shape(c), get_status: g, get_answer: shape(gc) })
  }
  return json({ ok: true, checked: out.length, results: out })
})
